import { ticks } from '@euroedge/fixed';
import { maintenanceMargin, notionalUsdc } from '@euroedge/risk-core';
import { accountEquity, accountMaintenance } from './accounting.ts';
import type { EngineInput } from './events.ts';
import type { EngineState, MarketState } from './state.ts';

/**
 * Snap period (M4-13, brief §6.4, review gate: math). PROPOSED rules:
 * - A snap is the first market data in window A after any other window (the reopen).
 * - For SNAP_MS after it, liquidation triggers on the mean of the marks received since the
 *   snap (≈ a 3-minute TWAP; the house is the only counterparty, so there is no volume to
 *   weight by). The snap print alone never liquidates; from the next print on, an account
 *   below maintenance at the spot mark but not at the mean is spared. An account insolvent
 *   at spot (equity < 0) is always liquidated. Liquidations still execute at the mark.
 * - If the snap mark lands outside the last pre-snap band, the market is reduce-only for
 *   SNAP_REDUCE_ONLY_MS.
 */
export const SNAP_MS = 180_000n;
export const SNAP_REDUCE_ONLY_MS = 300_000n;

type MarketDataInput = Extract<EngineInput, { type: 'MarketData' }>;

/** Updates the snap state from a market-data input, before it replaces `m.data`. */
export function trackSnap(m: MarketState, input: MarketDataInput, ts: bigint): void {
  const prev = m.data;
  if (prev !== undefined && prev.window !== 'A' && input.window === 'A') {
    m.snap = { startTs: ts, sum: input.mark, n: 1n };
    const outside = input.mark < prev.bandLo || input.mark > prev.bandHi;
    m.snapReduceOnlyUntil = outside ? ts + SNAP_REDUCE_ONLY_MS : null;
    return;
  }
  if (m.snap !== null) {
    m.snap =
      ts < m.snap.startTs + SNAP_MS
        ? { ...m.snap, sum: m.snap.sum + input.mark, n: m.snap.n + 1n }
        : null;
  }
  if (m.snapReduceOnlyUntil !== null && ts >= m.snapReduceOnlyUntil) m.snapReduceOnlyUntil = null;
}

/** True if, during a snap period, the account holds up at the mean mark and is solvent at spot. */
export function sparedBySnap(state: EngineState, account: string, market: string): boolean {
  const m = state.markets.get(market);
  const pos = state.accounts.get(account)?.positions.get(market);
  if (m?.data === undefined || m.snap === null || pos === undefined) return false;
  if (state.ts >= m.snap.startTs + SNAP_MS) return false;
  const spot = accountEquity(state, account) as bigint;
  if (spot < 0n) return false;
  // The snap print alone never liquidates a solvent account; later prints form the mean.
  if (m.snap.n < 2n) return true;
  const mean = m.snap.sum / m.snap.n;
  const tv = m.units.tickValue;
  const equity = spot + pos.lots * (mean - m.data.mark) * tv;
  const mmHere = (p: bigint) =>
    maintenanceMargin(notionalUsdc(pos.lots, ticks(p), tv), m.maintenanceMarginBps) as bigint;
  const mm = (accountMaintenance(state, account) as bigint) - mmHere(m.data.mark) + mmHere(mean);
  return equity >= mm;
}
