import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import { SimWorld } from '@euroedge/data-adapters';
import { loadFvParams, loadMarkets } from '@euroedge/shared/config';
import { BasketFvPipeline } from './basket.ts';
import { EwmaCovariance } from './covariance.ts';

const cet = (iso: string) => DateTime.fromISO(iso, { zone: 'Europe/Berlin' }).toMillis();

describe('EwmaCovariance', () => {
  it('is conservative (ρ = 1) until warm, then recovers the sample correlation', () => {
    const c = new EwmaCovariance(2, 0.97, 30);
    expect(c.portfolioSigma([0.5, 0.5], [0.02, 0.02])).toBeCloseTo(0.02, 12);
    // Perfectly anti-correlated returns.
    for (let k = 0; k < 200; k++) c.update(k % 2 === 0 ? [0.01, -0.01] : [-0.01, 0.01]);
    expect(c.correlation(0, 1)).toBeCloseTo(-1, 6);
    expect(c.portfolioSigma([0.5, 0.5], [0.02, 0.02])).toBeCloseTo(0, 6);
  });

  it('skips missing members pairwise', () => {
    const c = new EwmaCovariance(2, 0.9, 1);
    c.update([0.01, NaN]);
    expect(c.correlation(0, 1)).toBe(1); // no joint data → conservative
  });
});

describe('BasketFvPipeline (EE-Semis on the sim world)', () => {
  it('starts near the start level, tracks constituents, and drops members without data', async () => {
    const markets = await loadMarkets();
    const params = await loadFvParams();
    const semis = markets.find((m) => m.id === 'EUSEMI-PERP');
    if (semis === undefined) throw new Error('no basket');
    const world = new SimWorld({
      seed: 7,
      startTs: cet('2026-10-27T08:00'),
      markets: [semis, ...markets],
    });
    const p = new BasketFvPipeline(semis, markets, params, 50);
    const feed = (to: string) => {
      for (const t of world.advanceTo(cet(to))) p.onTick(t);
    };
    feed('2026-10-27T08:00');
    const first = p.evaluate(cet('2026-10-27T08:00:01'));
    expect(first?.snapshot.fv).toBeGreaterThan(900);
    expect(first?.snapshot.fv).toBeLessThan(1100);
    for (let h = 9; h <= 16; h++) {
      feed(`2026-10-27T${String(h).padStart(2, '0')}:00`);
      p.evaluate(cet(`2026-10-27T${String(h).padStart(2, '0')}:00`));
    }
    const out = p.evaluate(cet('2026-10-27T16:00:01'));
    const s = out?.snapshot;
    // Level matches the weighted true prices relative to their start prices.
    const truth =
      1000 *
      (0.35 * (world.truePrice('ASML-PERP') / 700) +
        0.2981 * (world.truePrice('IFX-PERP') / 35) +
        0.1491 * (world.truePrice('ASM') / 450) +
        0.1312 * (world.truePrice('STMPA') / 22) +
        0.0716 * (world.truePrice('BESI') / 120));
    expect(Math.abs(Math.log((s?.fv ?? 0) / truth))).toBeLessThan(0.01);
    expect(s?.window).toBe('A');
    expect(s?.dropped).toEqual([]);
    expect(out?.update.mark).toBeGreaterThan(0n);
    expect(p.warmGroups()).toHaveLength(5);

    // A basket whose constituents never trade: everything dropped → no FV.
    const lonely = new BasketFvPipeline(semis, markets, params, 50);
    expect(lonely.evaluate(cet('2026-10-27T16:00'))).toBeUndefined();
  }, 60_000);
});
