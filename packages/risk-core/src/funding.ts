import { abs, BPS_SCALE, clamp, divRound, PPM_SCALE, RATE_SCALE } from '@euroedge/fixed';

/**
 * Funding maths (ADR-0016, settlement rounding ADR-0018). Rates are `Rate` (1e-18) per hour;
 * a positive rate means longs pay shorts.
 */

export const HOURS_PER_YEAR = 8_760n;
export const MS_PER_HOUR = 3_600_000n;
/** ppm → Rate. */
const PPM_TO_RATE = RATE_SCALE / PPM_SCALE;

/** Interest component per hour: bps p.a. / 8760, truncated (5 % p.a. → 5 707 762 557 077). */
export const interestRatePerHour = (bpsPerYear: bigint): bigint =>
  divRound(bpsPerYear * RATE_SCALE, BPS_SCALE * HOURS_PER_YEAR, 'trunc');

export interface FundingRateInput {
  readonly interestBpsPerYear: bigint;
  /** Hourly cap on the total rate, ppm; null = interest only (Window D). */
  readonly capPpmPerHour: bigint | null;
  /** |netOIskew| at which the skew term reaches the cap, µUSDC; null = no skew term. */
  readonly oiCap: bigint | null;
  /** User long notional − user short notional at mark, µUSDC. */
  readonly netSkew: bigint;
  /** Stored, 0 in v1 (ADR-0016). */
  readonly quantoDrift: bigint;
}

/**
 * Total hourly rate: clamp(interest + skew + quantoDrift, ±cap), the cap on the sum.
 * Skew is linear, `cap × clamp(netSkew / oiCap, −1, 1)`, truncated toward zero.
 * Without a cap (Window D) the rate is interest + quantoDrift, unclamped.
 */
export function fundingRatePerHour(i: FundingRateInput): bigint {
  const interest = interestRatePerHour(i.interestBpsPerYear) + i.quantoDrift;
  if (i.capPpmPerHour === null) return interest;
  const cap = i.capPpmPerHour * PPM_TO_RATE;
  let skew = 0n;
  if (i.oiCap !== null && i.oiCap > 0n) {
    skew = divRound(cap * clamp(i.netSkew, -i.oiCap, i.oiCap), i.oiCap, 'trunc');
  }
  return clamp(interest + skew, -cap, cap);
}

/**
 * Funding index growth per lot over `dtMs` at a constant mark and rate, in µUSDC·Rate·ms
 * (exact, no rounding). A holder of `lots` owes `lots × ΔI / FUNDING_INDEX_SCALE` µUSDC.
 */
export const fundingIndexDelta = (
  markTicks: bigint,
  tickValue: bigint,
  ratePerHour: bigint,
  dtMs: bigint,
): bigint => markTicks * tickValue * ratePerHour * dtMs;

export const FUNDING_INDEX_SCALE = RATE_SCALE * MS_PER_HOUR;

export interface FundingSettlement {
  /** µUSDC per holder, same order as the input; > 0 pays, < 0 receives. */
  readonly payments: readonly bigint[];
  /** Σ payments ≥ 0: the rounding residue, routed to fees. */
  readonly residue: bigint;
}

/**
 * Rounds exact amounts owed (`due`, in index units; Σ due = 0 when the holders cover all open
 * interest incl. the house) to µUSDC. Payers round up, receivers toward zero (ADR-0018), so
 * the residue is never negative.
 */
export function settleFunding(due: readonly bigint[]): FundingSettlement {
  let residue = 0n;
  const payments = due.map((d) => {
    const p =
      d > 0n
        ? divRound(d, FUNDING_INDEX_SCALE, 'ceil')
        : -divRound(abs(d), FUNDING_INDEX_SCALE, 'trunc');
    residue += p;
    return p;
  });
  return { payments, residue };
}
