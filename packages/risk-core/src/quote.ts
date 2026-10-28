import {
  abs,
  BPS_SCALE,
  clamp,
  divRound,
  isqrtCeil,
  PPM_SCALE,
  ticks,
  type Ticks,
} from '@euroedge/fixed';

export interface HouseQuote {
  readonly bid: Ticks;
  readonly ask: Ticks;
}

/**
 * v1 testnet house quote (ADR-0003, M1 subset): FV ∓ halfSpread, bid rounded down and ask up
 * (house-favourable). Equal to `quotePrice` with every M4 term at zero.
 */
export function houseQuote(fv: Ticks, halfSpreadBps: bigint): HouseQuote {
  return {
    bid: ticks(divRound(fv * (BPS_SCALE - halfSpreadBps), BPS_SCALE, 'floor')),
    ask: ticks(divRound(fv * (BPS_SCALE + halfSpreadBps), BPS_SCALE, 'ceil')),
  };
}

/** priceLimit (≠ fvBand): no fill may deviate more than `limitBps` from the index. */
export const withinPriceLimit = (price: Ticks, index: Ticks, limitBps: bigint): boolean =>
  abs(price - index) * BPS_SCALE <= index * limitBps;

/** Quote parameters of one market in one window (ADR-0003, values proposed in ADR-0019). */
export interface QuoteParams {
  /** h_base. */
  readonly halfSpreadBps: bigint;
  /** a: adds `σ_FV × a / 10 000` to the half-spread. */
  readonly sigmaSpreadBps: bigint;
  /** s: inventory skew at |inventory| = inventoryCap. */
  readonly inventorySkewBps: bigint;
  /** House inventory (µUSDC at FV) at which the skew is full; null = no skew. */
  readonly inventoryCap: bigint | null;
  /** γ: marginal impact at notional = impactRef. */
  readonly impactBps: bigint;
  /** x_ref, µUSDC (> 0). */
  readonly impactRef: bigint;
  /** α in halves: 3 = 1.5, 4 = 2. */
  readonly impactAlphaHalves: bigint;
}

export interface QuoteInputs {
  readonly fv: Ticks;
  readonly sigmaPpm: bigint;
  /** House position at FV, µUSDC, signed (> 0 = house long). */
  readonly inventory: bigint;
  /** Flow shift (M4-03), ppm of FV, clamped here to ±half of h. */
  readonly shiftPpm: bigint;
  /** 2 while the market is degraded (brief §6.5), else 1. */
  readonly spreadMultiplier: bigint;
}

const BPS_TO_PPM = PPM_SCALE / BPS_SCALE;
/** Fixed-point scale for (q / x_ref)^1.5. */
const ROOT_SCALE = 1_000_000_000n;

/** h = h_base + a·σ_FV, ppm, rounded up. */
export const baseHalfSpreadPpm = (p: QuoteParams, sigmaPpm: bigint): bigint =>
  p.halfSpreadBps * BPS_TO_PPM + divRound(sigmaPpm * p.sigmaSpreadBps, BPS_SCALE, 'ceil');

/**
 * Inventory skew for a user `side` (+1 buy / −1 sell), ppm:
 * `s · clamp(inv / invCap, −1, 1) · (−side)`. It widens the side that adds to house inventory
 * and tightens the side that reduces it; rounded up (house-favourable).
 */
export function inventorySkewPpm(p: QuoteParams, inventory: bigint, side: 1n | -1n): bigint {
  const cap = p.inventoryCap;
  if (cap === null || cap <= 0n) return 0n;
  return divRound(
    -side * p.inventorySkewBps * BPS_TO_PPM * clamp(inventory, -cap, cap),
    cap,
    'ceil',
  );
}

/**
 * Average impact over a fill of `notional` µUSDC, ppm: `γ / (α + 1) · (q / x_ref)^α`.
 * α = 2 is exact; α = 1.5 uses a ceiling integer square root. Always rounded up.
 */
export function impactPpm(p: QuoteParams, notional: bigint): bigint {
  const n = abs(notional);
  const g = p.impactBps * BPS_TO_PPM;
  if (n === 0n || g === 0n) return 0n;
  const x = p.impactRef;
  if (p.impactAlphaHalves === 4n) return divRound(g * n * n, 3n * x * x, 'ceil');
  if (p.impactAlphaHalves !== 3n) throw new RangeError('impact α must be 1.5 or 2');
  // (n/x)^1.5 · ROOT_SCALE = √(n³ · ROOT_SCALE² / x³), rounded up; γ / 2.5 = 2γ / 5.
  const root = isqrtCeil(divRound(n * n * n * ROOT_SCALE * ROOT_SCALE, x * x * x, 'ceil'));
  return divRound(2n * g * root, 5n * ROOT_SCALE, 'ceil');
}

/** Total offset from FV for a fill, ppm (before the flow shift). */
export function halfSpreadPpm(
  p: QuoteParams,
  q: QuoteInputs,
  side: 1n | -1n,
  notional: bigint,
): bigint {
  const h =
    q.spreadMultiplier *
    (baseHalfSpreadPpm(p, q.sigmaPpm) + inventorySkewPpm(p, q.inventory, side));
  return (h > 0n ? h : 0n) + impactPpm(p, notional);
}

/**
 * Executable price for a fill of `notional` µUSDC on `side` (ADR-0003 steps 2–5):
 * `FV · (1 ± (h + skew + impact) + shift)`, the shift clamped to ±h/2. Ask rounds up, bid
 * down; the bid never goes below 0 (the price limit rejects such fills).
 */
export function quotePrice(
  p: QuoteParams,
  q: QuoteInputs,
  side: 1n | -1n,
  notional: bigint,
): Ticks {
  const h = q.spreadMultiplier * baseHalfSpreadPpm(p, q.sigmaPpm);
  const shift = clamp(q.shiftPpm, -h / 2n, h / 2n);
  const ratio = PPM_SCALE + side * halfSpreadPpm(p, q, side, notional) + shift;
  if (side === 1n) return ticks(divRound(q.fv * ratio, PPM_SCALE, 'ceil'));
  const bid = divRound(q.fv * ratio, PPM_SCALE, 'floor');
  return ticks(bid > 0n ? bid : 0n);
}

/** Ladder sizes (ADR-0003 step 8): €1k / €5k / €25k / €100k, µUSDC. */
export const LADDER_NOTIONALS = [1_000_000_000n, 5_000_000_000n, 25_000_000_000n, 100_000_000_000n];

export interface LadderRung {
  readonly notional: bigint;
  readonly bid: Ticks;
  readonly ask: Ticks;
}

/** The ladder, computed with the same function that fills. */
export const quoteLadder = (p: QuoteParams, q: QuoteInputs): LadderRung[] =>
  LADDER_NOTIONALS.map((notional) => ({
    notional,
    bid: quotePrice(p, q, -1n, notional),
    ask: quotePrice(p, q, 1n, notional),
  }));
