import { abs, BPS_SCALE, divRound, usdc, type Ticks, type Usdc } from '@euroedge/fixed';

/** Notional in µUSDC: |lots| × price × tickValue. */
export const notionalUsdc = (lots: bigint, price: Ticks, tickValue: Usdc): Usdc =>
  usdc(abs(lots) * price * tickValue);

/** Initial margin = notional / leverage, rounded up. Leverage 0 means reduce-only. */
export function initialMargin(notional: Usdc, maxLeverage: bigint): Usdc {
  if (maxLeverage <= 0n) throw new RangeError('reduce-only: no initial margin can be posted');
  return usdc(divRound(notional, maxLeverage, 'ceil'));
}

/** Maintenance margin = notional × MMR, rounded up (stocks 10 %, baskets 5 %). */
export const maintenanceMargin = (notional: Usdc, mmBps: bigint): Usdc =>
  usdc(divRound(notional * mmBps, BPS_SCALE, 'ceil'));

/** Liquidation penalty = notional × penalty, rounded up (ADR-0016). */
export const liquidationPenalty = (notional: Usdc, penaltyBps: bigint): Usdc =>
  usdc(divRound(notional * penaltyBps, BPS_SCALE, 'ceil'));

/**
 * Display-only liquidation price for an account whose only position is `lots` with cost
 * `cost` and `cash` µUSDC (cross margin, single market): solves equity(p) = MM(p).
 * Rounded toward the mark (shown earlier rather than later). undefined if never reached.
 */
export function liquidationPrice(
  cash: Usdc,
  lots: bigint,
  cost: bigint,
  tickValue: Usdc,
  mmBps: bigint,
): bigint | undefined {
  if (lots === 0n) return undefined;
  // cash + (p·L − cost)·tv = |L|·p·tv·m/1e4  →  p·tv·(L·1e4 − |L|·m) = (cost·tv − cash)·1e4
  const denom = tickValue * (lots * BPS_SCALE - abs(lots) * mmBps);
  const num = (cost * tickValue - cash) * BPS_SCALE;
  if (denom === 0n) return undefined;
  const p = divRound(num, denom, lots > 0n ? 'ceil' : 'floor');
  return p > 0n ? p : undefined;
}
