import { createHash } from 'node:crypto';
import type { EngineState } from '../core/state.ts';
import { canonicalJson } from './canonical.ts';

const byKey = <T>(entries: Iterable<[string, T]>) =>
  [...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

/** Deterministic, complete serialization of engine state (for replay == live, Invariant 6). */
export function stateSnapshot(state: EngineState): unknown {
  return {
    seq: state.seq,
    ts: state.ts,
    genesis: state.genesis,
    netDeposits: state.netDeposits,
    fundingNextTs: state.fundingNextTs,
    markets: byKey(state.markets).map(([, m]) => ({
      ...m,
      data: m.data ?? null,
      units: { ...m.units },
      funding: { ...m.funding },
    })),
    accounts: byKey(state.accounts).map(([id, a]) => ({
      id,
      positions: byKey(a.positions),
      funding: byKey(a.funding),
    })),
    ledger: state.ledger.entries(),
    idempotency: byKey(state.idempotency),
  };
}

/** sha256 of the canonical state snapshot. Equal digests ⇔ bit-for-bit equal state. */
export const stateDigest = (state: EngineState): string =>
  createHash('sha256')
    .update(canonicalJson(stateSnapshot(state)))
    .digest('hex');
