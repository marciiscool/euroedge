import type { Redis } from '@euroedge/service-kit';
import {
  CHANNELS,
  ENGINE_STREAM_MAXLEN,
  KEYS,
  STREAMS,
  type WithdrawalRecord,
} from '@euroedge/shared';
import type { EngineOutput } from './core/outputs.ts';
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
    publishWithdrawal(pipe, state, output);
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

type Pipeline = ReturnType<Redis['pipeline']>;

/**
 * Withdrawal records for the signer (M5-08), the indexer's expiry check (M5-10) and the API:
 * the record on every change, the pending set, and a stream entry per new reservation.
 */
function publishWithdrawal(pipe: Pipeline, state: EngineState, o: EngineOutput): void {
  const id =
    o.type === 'WithdrawalReserved'
      ? o.duplicate
        ? undefined
        : o.withdrawalId
      : o.type === 'WithdrawalSettled'
        ? o.withdrawalId
        : undefined;
  if (id === undefined) return;
  const w = state.withdrawals.get(id);
  if (w === undefined) return;
  const record: WithdrawalRecord = {
    id,
    account: w.account,
    amount: w.amount.toString(),
    nonce: w.nonce.toString(),
    deadlineMs: w.deadline.toString(),
    status: w.status,
  };
  pipe.set(KEYS.withdrawal(id), JSON.stringify(record));
  if (w.status === 'pending') {
    pipe
      .sadd(KEYS.pendingWithdrawals, id)
      .sadd(KEYS.accountWithdrawals(w.account), id)
      .xadd(STREAMS.withdrawals, 'MAXLEN', '~', String(ENGINE_STREAM_MAXLEN), '*', 'id', id);
  } else {
    pipe.srem(KEYS.pendingWithdrawals, id);
  }
}
