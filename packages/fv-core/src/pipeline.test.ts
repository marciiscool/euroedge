import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import { SimWorld } from '@euroedge/data-adapters';
import { loadFvParams, loadMarkets } from '@euroedge/shared/config';
import { MarketFvPipeline } from './pipeline.ts';

const cet = (iso: string) => DateTime.fromISO(iso, { zone: 'Europe/Berlin' }).toMillis();

describe('MarketFvPipeline on the simulated world', () => {
  it('tracks the latent price within its band through a session, with high confidence in Window A', async () => {
    const [asml] = await loadMarkets();
    if (asml === undefined) throw new Error('no market');
    const start = cet('2026-10-27T08:30');
    const world = new SimWorld({ seed: 11, startTs: start, markets: [asml] });
    const p = new MarketFvPipeline(asml, await loadFvParams(), 50);
    let inBand = 0;
    let total = 0;
    let lastA: ReturnType<MarketFvPipeline['evaluate']>;
    for (let ts = start; ts <= cet('2026-10-27T12:00'); ts += 1000) {
      for (const t of world.advanceTo(ts)) p.onTick(t);
      const out = p.evaluate(ts);
      if (out === undefined) continue;
      total += 1;
      const truth = world.truePrice('ASML-PERP');
      if (truth >= out.snapshot.bandLo && truth <= out.snapshot.bandHi) inBand += 1;
      expect(out.update.bandLo <= out.update.mark && out.update.mark <= out.update.bandHi).toBe(
        true,
      );
      if (out.update.window === 'A') lastA = out;
    }
    expect(total).toBeGreaterThan(12_000);
    // Seed parameters, not yet fitted (M3): the latent price should still mostly sit in the band.
    expect(inBand / total).toBeGreaterThan(0.8);
    expect(lastA?.snapshot.confidence).toBe('high');
    expect(lastA?.snapshot.sources.map((s) => s.kind)).toContain('tradegate');
  });
});

describe('MarketFvPipeline configuration', () => {
  it('consumes only the instruments a market has, and waits for an anchor', async () => {
    const [asml] = await loadMarkets();
    if (asml === undefined) throw new Error('no market');
    const params = await loadFvParams();
    const full = new MarketFvPipeline(asml, params, 50);
    expect(
      full
        .instruments()
        .map((i) => i.venue)
        .sort(),
    ).toEqual(['FX', 'TGAT', 'XAMS', 'XNAS']);
    const { adr: _adr, tradegateSymbol: _tg, ...bare } = asml;
    const p = new MarketFvPipeline(bare, params, 50);
    expect(
      p
        .instruments()
        .map((i) => i.venue)
        .sort(),
    ).toEqual(['FX', 'XAMS']);
    expect(p.evaluate(cet('2026-10-27T10:00'))).toBeUndefined();
    p.onTick({
      source: 'sim',
      instrument: { venue: 'XAMS', symbol: 'ASML' },
      ts: cet('2026-10-27T10:00'),
      currency: 'EUR',
      kind: 'close',
      last: 700,
    });
    const out = p.evaluate(cet('2026-10-27T10:00:01'));
    expect(out?.update.fv).toBe(70_000n);
    expect(out?.snapshot.confidence).toBe('none');
  });
});
