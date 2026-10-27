import type { Redis } from '@euroedge/service-kit';
import { CHANNELS, KEYS } from '@euroedge/shared';
import type { EngineState } from './core/state.ts';
import type { BatchResult } from './sequencer.ts';
import { accountSnapshot, marketSnapshot, orderResult } from './snapshots.ts';

/**
 * Publishes the read side after a batch is committed: order results, and fresh snapshots
 * of every market and account the batch touched (a mark change touches every account
 * holding that market). Snapshots are also stored for REST reads.
 */
export async function publishBatch(
  valkey: Redis,
  state: EngineState,
  batch: BatchResult,
): Promise<void> {
  const markets = new Set<string>();
  const accounts = new Set<string>();
  const pipe = valkey.pipeline();
  for (const { seq, output } of batch.outputs) {
    const result = orderResult(state, output, seq);
    if (result !== undefined) pipe.publish(CHANNELS.results, JSON.stringify(result));
    if (output.type === 'MarketChanged') markets.add(output.market);
    if (output.type === 'AccountChanged') accounts.add(output.account);
  }
  for (const id of markets) {
    for (const acc of state.accounts.values())
      if ((acc.positions.get(id)?.lots ?? 0n) !== 0n) accounts.add(acc.id);
  }
  for (const id of markets) {
    const snap = marketSnapshot(state, id);
    if (snap === undefined) continue;
    const json = JSON.stringify(snap);
    pipe.set(KEYS.market(id), json).publish(CHANNELS.market(id), json);
  }
  for (const id of accounts) {
    const json = JSON.stringify(accountSnapshot(state, id));
    pipe.set(KEYS.account(id), json).publish(CHANNELS.account(id), json);
  }
  await pipe.exec();
}

/** Full republish (startup): every market and account. */
export async function publishAll(valkey: Redis, state: EngineState): Promise<void> {
  await publishBatch(valkey, state, {
    events: [],
    skipped: [],
    outputs: [
      ...[...state.markets.keys()].map((market) => ({
        seq: state.seq,
        output: { type: 'MarketChanged' as const, market },
      })),
      ...[...state.accounts.keys()].map((account) => ({
        seq: state.seq,
        output: { type: 'AccountChanged' as const, account },
      })),
    ],
  });
}
