import { instrumentKey, type InstrumentRef } from './market-data.ts';
import type { MarketConfig, UnderlyingConfig } from './markets.ts';

/** A listed share with a stable id (market id for stock perps, constituent id otherwise). */
export interface Underlying extends UnderlyingConfig {
  readonly id: string;
  readonly name: string;
}

/** The listed lines through which an underlying is observed. */
export interface UnderlyingLines {
  readonly primary: InstrumentRef;
  readonly tradegate?: InstrumentRef;
  readonly adr?: InstrumentRef;
}

export function stockUnderlying(m: MarketConfig): Underlying {
  if (m.kind !== 'stock' || m.underlyingIsin === undefined || m.primarySymbol === undefined)
    throw new Error(`${m.id} is not a stock market`);
  const {
    underlyingIsin,
    primarySymbol,
    primaryMic,
    primaryCcy,
    adr,
    tradegateSymbol,
    sector,
    sim,
  } = m;
  return {
    id: m.id,
    name: m.displayName,
    underlyingIsin,
    primarySymbol,
    primaryMic,
    primaryCcy,
    sector,
    ...(adr === undefined ? {} : { adr }),
    ...(tradegateSymbol === undefined ? {} : { tradegateSymbol }),
    ...(sim === undefined ? {} : { sim }),
  };
}

export interface ResolvedConstituent {
  readonly id: string;
  readonly weightBps: number;
  /** The stock perp this constituent refers to, if any (shares its FV). */
  readonly market?: string;
  readonly underlying: Underlying;
}

/** Basket constituents with references to stock perps resolved to their underlyings. */
export function basketConstituents(
  basket: MarketConfig,
  markets: readonly MarketConfig[],
): ResolvedConstituent[] {
  return (basket.basket?.constituents ?? []).map((c) => {
    if ('market' in c) {
      const m = markets.find((x) => x.id === c.market);
      if (m === undefined) throw new Error(`${basket.id}: unknown market ${c.market}`);
      return { id: c.id, weightBps: c.weightBps, market: m.id, underlying: stockUnderlying(m) };
    }
    const { weightBps, ...u } = c;
    return { id: c.id, weightBps, underlying: u };
  });
}

/**
 * Every distinct underlying across stock perps and basket constituents, stock perps first.
 * Constituents are deduplicated by ISIN (IFX appears in two baskets, ASML in a basket and a perp).
 */
export function allUnderlyings(markets: readonly MarketConfig[]): Underlying[] {
  const out = new Map<string, Underlying>();
  for (const m of markets)
    if (m.kind === 'stock') out.set(m.underlyingIsin ?? m.id, stockUnderlying(m));
  for (const m of markets)
    for (const c of basketConstituents(m, markets))
      if (!out.has(c.underlying.underlyingIsin)) out.set(c.underlying.underlyingIsin, c.underlying);
  return [...out.values()];
}

export function underlyingLines(u: UnderlyingConfig): UnderlyingLines {
  return {
    primary: { venue: u.primaryMic, symbol: u.primarySymbol },
    ...(u.tradegateSymbol === undefined
      ? {}
      : { tradegate: { venue: 'TGAT' as const, symbol: u.tradegateSymbol } }),
    ...(u.adr === undefined ? {} : { adr: { venue: u.adr.venue, symbol: u.adr.symbol } }),
  };
}

export const lineKeys = (l: UnderlyingLines): string[] =>
  [l.primary, l.tradegate, l.adr].flatMap((r) => (r === undefined ? [] : [instrumentKey(r)]));
