import { cappedFlow, decayFlow, flowShiftPpm } from '@euroedge/risk-core';
import type { AccountId } from './events.ts';
import type { MarketState } from './state.ts';

/**
 * Flow shift (ADR-0003 step 4, ADR-0019). The decayed net user flow moves the house quotes
 * only — never FV, index or mark. Liquidations do not count as flow.
 */

/** Quote shift in ppm at event time `ts` (read-only: decays a copy). */
export function flowShift(m: MarketState, ts: bigint): bigint {
  const p = m.flowParams;
  if (p.kappaPpmPerMUsdc === 0n) return 0n;
  const sec = ts / 1000n;
  const sum = decayFlow(m.flow.sum, p.tauSec, sec > m.flow.sec ? sec - m.flow.sec : 0n);
  return flowShiftPpm(sum, p.kappaPpmPerMUsdc);
}

/** Adds a user fill (signed notional, µUSDC) to the flow, within the wallet's cap. */
export function recordFlow(
  m: MarketState,
  account: AccountId,
  signedNotional: bigint,
  ts: bigint,
): void {
  const p = m.flowParams;
  const f = m.flow;
  const sec = ts / 1000n;
  if (sec > f.sec) {
    f.sum = decayFlow(f.sum, p.tauSec, sec - f.sec);
    f.sec = sec;
  }
  const window = sec / p.walletWindowSec;
  if (window !== f.window) {
    f.wallets.clear();
    f.window = window;
  }
  const r = cappedFlow(signedNotional, f.wallets.get(account) ?? 0n, p.walletCap);
  if (r.counted === 0n) return;
  f.wallets.set(account, r.used);
  f.sum += r.counted;
}
