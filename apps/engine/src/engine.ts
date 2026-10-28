import { migrate } from '@euroedge/db';
import { createValkey, type Logger, type Redis } from '@euroedge/service-kit';
import {
  encodeEngineCommand,
  ENGINE_STREAM_MAXLEN,
  KEYS,
  STREAMS,
  type DataTier,
  type MarketConfig,
  type WindowsFile,
} from '@euroedge/shared';
import { bootstrapInputs } from './bootstrap.ts';
import type { EngineState } from './core/state.ts';
import { stateDigest } from './log/digest.ts';
import { restoreFromLog, SnapshotMismatch } from './log/restore.ts';
import { encodeState } from './log/state-codec.ts';
import { EventStore } from './log/store.ts';
import pg from 'pg';
import { catchUpProjection, project, writeProjection } from './projections.ts';
import { publishAll, publishBatch } from './publisher.ts';
import { balanceSnapshot, HOUR_MS } from './balances.ts';
import { Sequencer, type BatchResult } from './sequencer.ts';

export interface EngineOptions {
  readonly databaseUrl: string;
  readonly valkeyUrl: string;
  readonly tier: DataTier;
  readonly markets: readonly MarketConfig[];
  readonly windows: WindowsFile;
  readonly log: Logger;
  readonly clockTickMs?: number;
  /** Store a state snapshot every N events (M4-19); 0 disables. Default 10 000. */
  readonly snapshotEvery?: number;
  /** ADR-0013: `chain` waits for the Vault's GenesisFunded instead of injecting dev genesis. */
  readonly genesisSource?: 'dev' | 'chain';
}

export interface RunningEngine {
  readonly state: EngineState;
  readonly sequencer: Sequencer;
  stop(): Promise<void>;
}

/** Enqueues an engine input (used by producers and by the engine's own clock). */
export async function enqueueInput(valkey: Redis, input: unknown): Promise<string | null> {
  return valkey.xadd(
    STREAMS.engineInput,
    'MAXLEN',
    '~',
    String(ENGINE_STREAM_MAXLEN),
    '*',
    'input',
    encodeEngineCommand(input),
  );
}

/**
 * Starts the single-writer engine: take the lock, replay and verify the log, bootstrap
 * config inputs, then consume the input stream until stopped. Fatal errors exit the process.
 */
export async function startEngine(o: EngineOptions): Promise<RunningEngine> {
  await migrate(o.databaseUrl);
  const store = new EventStore(o.databaseUrl);
  await store.acquireWriterLock();

  // Restore from the newest snapshot if it checks out against the log; else from genesis.
  const [latest] = await store.snapshots(true);
  let restored;
  try {
    restored = await restoreFromLog(store.readAll(), latest);
  } catch (err) {
    if (!(err instanceof SnapshotMismatch)) throw err;
    o.log.warn({ err }, 'snapshot rejected; replaying from genesis');
    restored = await restoreFromLog(store.readAll());
  }
  const { state } = restored;
  o.log.info(
    { seq: state.seq.toString(), head: restored.head.hash, snapshot: restored.from.toString() },
    'engine state restored from log',
  );
  const every = BigInt(o.snapshotEvery ?? 10_000);
  let lastSnapshot = restored.from;
  const maybeSnapshot = async () => {
    if (every <= 0n || state.seq / every <= lastSnapshot / every) return;
    const body = encodeState(state);
    try {
      await store.writeSnapshot({
        seq: state.seq,
        chainHash: store.head.hash,
        digest: stateDigest(state),
        body,
      });
      lastSnapshot = state.seq;
    } catch (err) {
      o.log.warn({ err, seq: state.seq.toString() }, 'snapshot write failed');
    }
  };

  const valkey = createValkey(o.valkeyUrl, 'engine');
  const reader = createValkey(o.valkeyUrl, 'engine-reader');
  const sequencer = new Sequencer(state, store);
  const boot = await sequencer.processInputs(
    bootstrapInputs(state, o.markets, o.windows, o.tier, o.genesisSource),
  );
  if (boot.events.length > 0)
    o.log.info({ events: boot.events.length }, 'bootstrap inputs applied');
  await publishAll(valkey, state);

  // Hourly balance snapshot for the root poster (M5-12): once per event-time hour.
  let balancesHour = BigInt((await valkey.get(KEYS.latestBalanceHour)) ?? '0');
  const maybePublishBalances = async () => {
    const hour = state.ts / HOUR_MS;
    if (hour <= balancesHour || !state.genesis) return;
    const snap = balanceSnapshot(state, hour);
    await valkey
      .pipeline()
      .set(KEYS.balanceSnapshot(snap.hour), JSON.stringify(snap))
      .set(KEYS.latestBalanceHour, snap.hour)
      .xadd(STREAMS.balanceRoots, 'MAXLEN', '~', '10000', '*', 'hour', snap.hour)
      .exec();
    balancesHour = hour;
  };

  // Read models (M4-22): derived, so a failed write is logged and repaired by catch-up.
  const rm = new pg.Pool({ connectionString: o.databaseUrl, max: 2 });
  let rmBehind = true;
  const catchUp = async () => {
    try {
      const n = await catchUpProjection(store.readAll(), rm);
      if (n > 0n) o.log.info({ events: n.toString() }, 'read models caught up');
      rmBehind = false;
    } catch (err) {
      o.log.warn({ err }, 'read-model catch-up failed; retrying with the next batch');
    }
  };
  await catchUp();
  const projectBatch = async (batch: BatchResult) => {
    if (rmBehind) return catchUp();
    const ts = new Map(batch.events.map((e) => [e.seq, e.ts]));
    const last = batch.events.at(-1)?.seq;
    if (last === undefined) return;
    try {
      const outputs = batch.outputs.map((x) => ({ ...x, ts: ts.get(x.seq) ?? 0n }));
      await writeProjection(rm, project(outputs), last);
    } catch (err) {
      rmBehind = true;
      o.log.warn({ err }, 'read-model write failed; will catch up');
    }
  };

  let stopping = false;
  let cursor = (await store.cursor()) ?? '0-0';
  const clock = setInterval(
    () => void enqueueInput(valkey, { type: 'ClockTick' }),
    o.clockTickMs ?? 1000,
  );

  const loop = (async () => {
    while (!stopping) {
      let res: [string, [string, string[]][]][] | null;
      try {
        res = await reader.xread(
          'COUNT',
          512,
          'BLOCK',
          500,
          'STREAMS',
          STREAMS.engineInput,
          cursor,
        );
      } catch (err) {
        if (stopping) return;
        o.log.warn({ err }, 'xread failed; retrying');
        await new Promise((r) => setTimeout(r, 500));
        continue;
      }
      const entries = res?.[0]?.[1] ?? [];
      if (entries.length === 0) continue;
      const messages = entries.map(([id, fields]) => ({
        id,
        payload: fields[fields.indexOf('input') + 1] ?? '',
      }));
      try {
        const batch = await sequencer.processMessages(messages);
        for (const s of batch.skipped) o.log.warn(s, 'invalid engine input skipped');
        cursor = messages.at(-1)?.id ?? cursor;
        await publishBatch(valkey, state, batch);
        await maybeSnapshot();
        await maybePublishBalances();
        await projectBatch(batch);
      } catch (err) {
        o.log.fatal({ err }, 'engine fail-stop: state may be ahead of the log; exiting to rebuild');
        process.exit(1);
      }
    }
  })();

  return {
    state,
    sequencer,
    async stop() {
      stopping = true;
      clearInterval(clock);
      reader.disconnect();
      await loop.catch(() => undefined);
      valkey.disconnect();
      await rm.end();
      await store.close();
    },
  };
}
