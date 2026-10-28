import { abs, type Ticks } from '@euroedge/fixed';
import {
  quoteLadder,
  quotePrice,
  type LadderRung,
  type QuoteInputs,
  type QuoteParams,
} from '@euroedge/risk-core';
import { flowShift } from './flow.ts';
import type { MarketState } from './state.ts';

/** The window's quote parameters (ADR-0003). */
export function quoteParams(m: MarketState): QuoteParams | undefined {
  const d = m.data;
  if (d === undefined) return undefined;
  const r = m.windows[d.window];
  return {
    halfSpreadBps: r.houseHalfSpreadBps,
    sigmaSpreadBps: r.sigmaSpreadBps,
    inventorySkewBps: r.inventorySkewBps,
    inventoryCap: r.inventoryCap,
    impactBps: r.impactBps,
    impactRef: r.impactRef,
    impactAlphaHalves: r.impactAlphaHalves,
  };
}

/** Quote state at event time `ts`: FV, σ, house inventory at FV, flow shift, degraded. */
export function quoteInputs(m: MarketState, ts: bigint): QuoteInputs | undefined {
  const d = m.data;
  if (d === undefined) return undefined;
  return {
    fv: d.fv,
    sigmaPpm: d.sigmaPpm,
    inventory: m.house.lots * d.fv * m.units.tickValue,
    shiftPpm: flowShift(m, ts),
    // Degraded markets quote twice the usual half-spread (brief §6.5).
    spreadMultiplier: d.breaker === 'degraded' ? 2n : 1n,
  };
}

/** Executable house price for a fill of signed `qty` lots, sized at FV notional. */
export function executablePrice(m: MarketState, qty: bigint, ts: bigint): Ticks | undefined {
  const p = quoteParams(m);
  const q = quoteInputs(m, ts);
  if (p === undefined || q === undefined) return undefined;
  return quotePrice(p, q, qty > 0n ? 1n : -1n, abs(qty) * q.fv * m.units.tickValue);
}

/** Top of book (zero size) and the €1k–€100k ladder, from the function that fills. */
export function marketQuote(
  m: MarketState,
  ts: bigint,
): { bid: Ticks; ask: Ticks; ladder: LadderRung[] } | undefined {
  const p = quoteParams(m);
  const q = quoteInputs(m, ts);
  if (p === undefined || q === undefined) return undefined;
  return {
    bid: quotePrice(p, q, -1n, 0n),
    ask: quotePrice(p, q, 1n, 0n),
    ladder: quoteLadder(p, q),
  };
}
