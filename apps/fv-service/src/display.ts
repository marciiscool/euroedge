import { ticks, ticksToPrice, type MarketUnits } from '@euroedge/fixed';
import type { PipelineOutput } from '@euroedge/fv-core';
import type { FvDisplaySnapshot } from '@euroedge/shared';

const price = (units: MarketUnits, p: number) =>
  ticksToPrice(units, ticks(BigInt(Math.round(p / Number(units.tickSize)))));

/** Display snapshot for the UI (price provenance, brief §11.2). Decimal strings at tick precision. */
export function displaySnapshot(
  market: string,
  units: MarketUnits,
  out: PipelineOutput,
  next: { at: number; window: FvDisplaySnapshot['window'] } | undefined,
): FvDisplaySnapshot {
  const { snapshot: s, update: u } = out;
  return {
    market,
    ts: s.ts,
    window: u.window,
    fv: ticksToPrice(units, ticks(u.fv)),
    bandLo: ticksToPrice(units, ticks(u.bandLo)),
    bandHi: ticksToPrice(units, ticks(u.bandHi)),
    index: ticksToPrice(units, ticks(u.index)),
    mark: ticksToPrice(units, ticks(u.mark)),
    sigmaBp: Math.round(s.sigma * 1e4 * 100) / 100,
    confidence: s.confidence,
    anchor: { price: price(units, s.anchor.price), ts: s.anchor.ts },
    sources: s.sources.map((x) => ({
      kind: x.kind,
      weight: Math.round(x.weight * 1000) / 1000,
      ageMs: x.ageMs,
      implied: price(units, x.implied),
    })),
    nextWindowChange: next ?? null,
    breakers: [],
    breakerEffect: 'none',
    dropped: [...(s.dropped ?? [])],
    fxAlert: s.fxAlert,
  };
}
