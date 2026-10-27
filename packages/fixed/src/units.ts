import { decimalParts, formatDecimal } from './decimal.ts';
import { abs, divRound, pow10, type Rounding } from './rounding.ts';
import {
  BPS_SCALE,
  PPM_SCALE,
  USDC_SCALE,
  lots,
  ticks,
  usdc,
  type Bps,
  type Lots,
  type Ppm,
  type Ticks,
  type Usdc,
} from './types.ts';

/** Market unit definition as written in markets.yaml (decimal strings). */
export interface UnitSpec {
  /** Price increment in EUR (quanto: 1 EUR-point = 1 USDC per contract). */
  readonly tickSize: string;
  /** Quantity increment in shares or basket units. */
  readonly lotSize: string;
}

export interface MarketUnits extends UnitSpec {
  /** µUSDC value of one tick on one lot: tickSize × lotSize × 1e6. Always an integer. */
  readonly tickValue: Usdc;
}

/**
 * Validates a unit spec and derives the integer tick value (ADR-0002). Rejects specs whose
 * tick value is not a whole number of µUSDC, which would make PnL inexact.
 */
export function resolveUnits(spec: UnitSpec): MarketUnits {
  const t = decimalParts(spec.tickSize);
  const l = decimalParts(spec.lotSize);
  if (t.num <= 0n || l.num <= 0n) throw new RangeError('tickSize and lotSize must be positive');
  const num = t.num * l.num * USDC_SCALE;
  const den = pow10(t.decimals + l.decimals);
  if (num % den !== 0n) {
    throw new RangeError(
      `tickSize ${spec.tickSize} × lotSize ${spec.lotSize} is not a whole number of µUSDC`,
    );
  }
  return { ...spec, tickValue: usdc(num / den) };
}

/** Converts a decimal amount to an integer count of `step` units (exact unless mode given). */
function toSteps(amount: string, step: string, mode: Rounding | undefined, what: string): bigint {
  const a = decimalParts(amount);
  const s = decimalParts(step);
  const num = a.num * pow10(s.decimals);
  const den = s.num * pow10(a.decimals);
  if (mode === undefined && num % den !== 0n) {
    throw new RangeError(`${what} ${amount} is not a multiple of ${step}; pass a rounding mode`);
  }
  return divRound(num, den, mode ?? 'trunc');
}

export const priceToTicks = (u: UnitSpec, price: string, mode?: Rounding): Ticks =>
  ticks(toSteps(price, u.tickSize, mode, 'price'));

export const qtyToLots = (u: UnitSpec, qty: string, mode?: Rounding): Lots =>
  lots(toSteps(qty, u.lotSize, mode, 'quantity'));

/** Exact decimal rendering of `count × step`. */
function fromSteps(count: bigint, step: string): string {
  const s = decimalParts(step);
  return formatDecimal(count * s.num, s.decimals);
}

export const ticksToPrice = (u: UnitSpec, t: Ticks): string => fromSteps(t, u.tickSize);
export const lotsToQty = (u: UnitSpec, l: Lots): string => fromSteps(l, u.lotSize);

/** Notional in µUSDC of `l` lots at price `p` (signed with `l`). Exact. */
export const notional = (u: MarketUnits, p: Ticks, l: Lots): Usdc => usdc(p * l * u.tickValue);

/**
 * PnL in µUSDC of a signed position (`l` > 0 long, < 0 short) moving from `entry` to `exit`.
 * Exact — no rounding — because tickValue is an integer (ADR-0002).
 */
export const pnl = (u: MarketUnits, entry: Ticks, exit: Ticks, l: Lots): Usdc =>
  usdc((exit - entry) * l * u.tickValue);

/** Fee on |amount| at `rate` bps, rounded up (ceil) — fees never round in the payer's favour. */
export const feeBps = (amount: Usdc, rate: Bps): Usdc =>
  usdc(divRound(abs(amount) * rate, BPS_SCALE, 'ceil'));

/** amount × rate (bps) with an explicit rounding mode, sign preserved. */
export const applyBps = (amount: Usdc, rate: Bps, mode: Rounding): Usdc =>
  usdc(divRound(amount * rate, BPS_SCALE, mode));

/** amount × rate (ppm) with an explicit rounding mode, sign preserved. */
export const applyPpm = (amount: Usdc, rate: Ppm, mode: Rounding): Usdc =>
  usdc(divRound(amount * rate, PPM_SCALE, mode));
