import { migrate } from '@euroedge/db';
import { createValkey, type Logger, type Redis } from '@euroedge/service-kit';
import { STREAMS, type DataTier, type MarketConfig, type WindowsFile } from '@euroedge/shared';
import { bootstrapInputs } from './bootstrap.ts';
import { apply } from './core/apply.ts';
import { createState, type EngineState } from './core/state.ts';
import { canonicalJson } from './log/canonical.ts';
import { chainHash, decodeEvent, GENESIS_HASH } from './log/codec.ts';
import { EventStore } from './log/store.ts';
import { publishAll, publishBatch } from './publisher.ts';
import { Sequencer } from './sequencer.ts';

export interface EngineOptions {
  readonly databaseUrl: string;
  readonly valkeyUrl: string;
  readonly tier: DataTier;
  readonly markets: readonly MarketConfig[];
  readonly windows: WindowsFile;
  readonly log: Logger;
  readonly clockTickMs?: number;
}

export interface RunningEngine {
  readonly state: EngineState;
  readonly sequencer: Sequencer;
  stop(): Promise<void>;
}

const STREAM_MAXLEN = '100000';

/** Enqueues an engine input (used by producers and by the engine's own clock). */
export async function enqueueInput(valkey: Redis, input: unknown): Promise<string | null> {
  return valkey.xadd(
    STREAMS.engineInput,
    'MAXLEN',
    '~',
    STREAM_MAXLEN,
    '*',
    'input',
    canonicalJson(input),
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

  const state = createState();
  let prev = GENESIS_HASH;
  for await (const rec of store.readAll()) {
    prev = chainHash(prev, rec.body);
    if (prev !== rec.hash) throw new Error(`hash chain broken at seq ${rec.seq}`);
    apply(state, decodeEvent(rec.body));
  }
  o.log.info({ seq: state.seq.toString(), head: prev }, 'engine state replayed from log');

  const valkey = createValkey(o.valkeyUrl, 'engine');
  const reader = createValkey(o.valkeyUrl, 'engine-reader');
  const sequencer = new Sequencer(state, store);
  const boot = await sequencer.processInputs(bootstrapInputs(state, o.markets, o.windows, o.tier));
  if (boot.events.length > 0)
    o.log.info({ events: boot.events.length }, 'bootstrap inputs applied');
  await publishAll(valkey, state);

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
      await store.close();
    },
  };
}
