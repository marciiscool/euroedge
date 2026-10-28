import { abs, clamp, divRound, RATE_SCALE } from '@euroedge/fixed';

/**
 * Flow shift (ADR-0003 step 4, ADR-0019): an exponentially decayed sum of signed user
 * notional, decaying by (1 − 1/τ) per whole second of event time, in 1e18 fixed point.
 */

/** (1 − 1/τ)^seconds in 1e18, by square-and-multiply, truncating each product. */
export function flowDecayFactor(tauSec: bigint, seconds: bigint): bigint {
  if (tauSec <= 0n) throw new RangeError('flow τ must be > 0');
  if (seconds < 0n) throw new RangeError('flow decay over negative time');
  let base = RATE_SCALE - RATE_SCALE / tauSec;
  let r = RATE_SCALE;
  let e = seconds;
  while (e > 0n && r > 0n) {
    if (e & 1n) r = (r * base) / RATE_SCALE;
    base = (base * base) / RATE_SCALE;
    e >>= 1n;
  }
  return r;
}

/** The decayed sum after `seconds`, truncated toward zero (µUSDC). */
export const decayFlow = (sum: bigint, tauSec: bigint, seconds: bigint): bigint =>
  seconds === 0n ? sum : divRound(sum * flowDecayFactor(tauSec, seconds), RATE_SCALE, 'trunc');

/** κ · netFlow in ppm, κ in ppm per 1 000 000 USDC; truncated toward zero (clamped by the quote). */
export const flowShiftPpm = (sum: bigint, kappaPpmPerMUsdc: bigint): bigint =>
  divRound(sum * kappaPpmPerMUsdc, 1_000_000_000_000n, 'trunc');

/**
 * Per-wallet cap: of a fill's signed notional, only what fits under `cap − used` in the current
 * window counts. Returns the counted (signed) part and the wallet's new usage.
 */
export function cappedFlow(
  signedNotional: bigint,
  used: bigint,
  cap: bigint,
): { readonly counted: bigint; readonly used: bigint } {
  const room = clamp(cap - used, 0n, cap);
  const n = abs(signedNotional);
  const take = n < room ? n : room;
  return { counted: signedNotional < 0n ? -take : take, used: used + take };
}
