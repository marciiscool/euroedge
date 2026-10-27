import pg from 'pg';
import { CalendarCache, nextWindowChange } from '@euroedge/calendar';
import { resolveUnits } from '@euroedge/fixed';
import { BasketFvPipeline, MarketFvPipeline } from '@euroedge/fv-core';
import { createValkey, type Logger } from '@euroedge/service-kit';
import {
  CHANNELS,
  encodeEngineCommand,
  ENGINE_STREAM_MAXLEN,
  KEYS,
  STREAMS,
  tickSchema,
  type FvDisplaySnapshot,
  type FvParams,
  type MarketConfig,
  type Tick,
  type Window,
} from '@euroedge/shared';
import { displaySnapshot } from './display.ts';
import { warmStartTicks } from './warm-start.ts';

export interface FvServiceOptions {
  readonly databaseUrl: string;
  readonly valkeyUrl: string;
  readonly markets: readonly MarketConfig[];
  /** Every configured market, to resolve basket constituents (default: `markets`). */
  readonly catalog?: readonly MarketConfig[];
  readonly params: FvParams;
  readonly stepCapBpsPerSecond: number;
  readonly log: Logger;
  readonly now?: () => number;
}

export interface RunningFvService {
  /** Evaluates every market once at `ts` (the 1 s timer calls this). */
  evaluateAt(ts: number): Promise<number>;
  lastPublishAt(): number;
  stop(): Promise<void>;
}

interface MarketRuntime {
  readonly pipeline: MarketFvPipeline | BasketFvPipeline;
  readonly config: MarketConfig;
  readonly units: ReturnType<typeof resolveUnits>;
  next: { at: number; window: Window } | undefined;
}

/** fv-service (brief §6): ticks → per-market pipeline → engine MarketData input every second. */
export async function startFvService(o: FvServiceOptions): Promise<RunningFvService> {
  const now = o.now ?? Date.now;
  const db = new pg.Pool({ connectionString: o.databaseUrl, max: 3 });
  const valkey = createValkey(o.valkeyUrl, 'fv-service');
  const sub = createValkey(o.valkeyUrl, 'fv-service-sub');
  const calendar = new CalendarCache();
  const runtimes = o.markets.map((m): MarketRuntime => ({
    pipeline:
      m.kind === 'basket'
        ? new BasketFvPipeline(m, o.catalog ?? o.markets, o.params, o.stepCapBpsPerSecond, calendar)
        : new MarketFvPipeline(m, o.params, o.stepCapBpsPerSecond, calendar),
    config: m,
    units: resolveUnits(m),
    next: undefined,
  }));

  // Subscribe first and buffer, then warm-start from the DB, then drain the buffer.
  let warming = true;
  const buffered: Tick[] = [];
  let lastWarmTs = 0;
  const feed = (t: Tick) => {
    for (const r of runtimes) r.pipeline.onTick(t);
  };
  sub.on('message', (_ch: string, msg: string) => {
    const parsed = tickSchema.safeParse(JSON.parse(msg));
    if (!parsed.success) return;
    if (warming) buffered.push(parsed.data);
    else feed(parsed.data);
  });
  await sub.subscribe(CHANNELS.ticks);
  for (const r of runtimes) {
    let n = 0;
    for (const [primary, ...others] of r.pipeline.warmGroups()) {
      if (primary === undefined) continue;
      const warm = await warmStartTicks(db, primary, others);
      for (const t of warm) r.pipeline.onTick(t);
      lastWarmTs = Math.max(lastWarmTs, ...warm.map((t) => t.ts));
      n += warm.length;
    }
    o.log.info({ market: r.config.id, ticks: n }, 'fv warm start');
  }
  warming = false;
  for (const t of buffered.filter((x) => x.ts > lastWarmTs)) feed(t);

  let lastPublish = 0;
  const pendingRows: unknown[][] = [];

  const evaluateAt = async (ts: number): Promise<number> => {
    const pipe = valkey.pipeline();
    let published = 0;
    for (const r of runtimes) {
      const out = r.pipeline.evaluate(ts);
      if (out === undefined) continue;
      const u = out.update;
      pipe.xadd(
        STREAMS.engineInput,
        'MAXLEN',
        '~',
        String(ENGINE_STREAM_MAXLEN),
        '*',
        'input',
        encodeEngineCommand({
          type: 'MarketData',
          market: r.config.id,
          window: u.window,
          fv: u.fv,
          bandLo: u.bandLo,
          bandHi: u.bandHi,
          index: u.index,
          mark: u.mark,
          markClamped: u.markClamped,
          sigmaPpm: u.sigmaPpm,
        }),
      );
      if (r.next === undefined || ts >= r.next.at) {
        r.next = nextWindowChange(
          { primary: r.config.primaryMic, extended: r.config.extendedMic },
          ts,
        );
      }
      const view: FvDisplaySnapshot = displaySnapshot(r.config.id, r.units, out, r.next);
      const json = JSON.stringify(view);
      pipe.set(KEYS.fv(r.config.id), json).publish(CHANNELS.fv(r.config.id), json);
      pendingRows.push([
        ts,
        r.config.id,
        view.window,
        view.fv,
        view.bandLo,
        view.bandHi,
        view.index,
        view.mark,
        view.sigmaBp,
        view.confidence,
      ]);
      published += 1;
    }
    await pipe.exec();
    if (published > 0) lastPublish = now();
    return published;
  };

  const flushRows = async () => {
    const rows = pendingRows.splice(0);
    if (rows.length === 0) return;
    const col = (i: number) => rows.map((r) => r[i]);
    await db.query(
      `INSERT INTO fv_series (ts, market, win, fv, band_lo, band_hi, idx, mark, sigma_bp, confidence)
       SELECT to_timestamp(t / 1000.0), m, w, f, bl, bh, i, mk, s, c
       FROM unnest($1::bigint[], $2::text[], $3::text[], $4::numeric[], $5::numeric[], $6::numeric[],
                   $7::numeric[], $8::numeric[], $9::float8[], $10::text[]) AS u(t, m, w, f, bl, bh, i, mk, s, c)`,
      [col(0), col(1), col(2), col(3), col(4), col(5), col(6), col(7), col(8), col(9)],
    );
  };

  // 1 s cadence aligned to whole seconds (brief §6: every 1 s per market).
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const schedule = () => {
    if (stopped) return;
    const delay = 1000 - (now() % 1000);
    timer = setTimeout(() => {
      const ts = Math.floor(now() / 1000) * 1000;
      evaluateAt(ts)
        .then(flushRows)
        .catch((err: unknown) => o.log.error({ err }, 'fv evaluation failed'))
        .finally(schedule);
    }, delay);
  };
  schedule();

  return {
    evaluateAt,
    lastPublishAt: () => lastPublish,
    async stop() {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
      await flushRows().catch(() => undefined);
      sub.disconnect();
      valkey.disconnect();
      await db.end();
    },
  };
}
