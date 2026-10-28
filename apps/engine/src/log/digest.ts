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
    genesisCapital: state.genesisCapital,
    capitalFloor: state.capitalFloor,
    houseRisk: state.houseRisk,
    netDeposits: state.netDeposits,
    markets: byKey(state.markets).map(([, m]) => ({
      ...m,
      data: m.data ?? null,
      units: { ...m.units },
      flow: { ...m.flow, wallets: byKey(m.flow.wallets) },
      earnings: byKey(m.earnings),
    })),
    accounts: byKey(state.accounts).map(([id, a]) => ({ id, positions: byKey(a.positions) })),
    ledger: state.ledger.entries(),
    idempotency: byKey(state.idempotency),
    orders: byKey(state.orders),
    withdrawals: byKey(state.withdrawals),
    withdrawalNonce: state.withdrawalNonce,
    dividends: byKey(state.dividends),
  };
}

/** sha256 of the canonical state snapshot. Equal digests ⇔ bit-for-bit equal state. */
export const stateDigest = (state: EngineState): string =>
  createHash('sha256')
    .update(canonicalJson(stateSnapshot(state)))
    .digest('hex');
