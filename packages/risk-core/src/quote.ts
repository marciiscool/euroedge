import { abs, BPS_SCALE, divRound, ticks, type Ticks } from '@euroedge/fixed';

export interface HouseQuote {
  readonly bid: Ticks;
  readonly ask: Ticks;
}

/**
 * v1 testnet house quote (ADR-0003, M1 subset): FV ∓ halfSpread, bid rounded down and ask up
 * (house-favourable). Size impact, inventory skew and flow shift arrive in M4.
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
