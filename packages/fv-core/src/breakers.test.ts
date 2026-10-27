import { describe, expect, it } from 'vitest';
import { loadFvParams } from '@euroedge/shared/config';
import { BasketDrawdownBreaker, MarketBreakers, type BreakerInput } from './breakers.ts';

const params = await loadFvParams();
const T0 = 1_793_000_000_000;
const S = 1000;
const tg = (implied: number, ageMs = 500) => ({
  kind: 'tradegate' as const,
  weight: 0.5,
  ageMs,
  implied,
});
const adr = (implied: number, ageMs = 500) => ({
  kind: 'adr' as const,
  weight: 0.5,
  ageMs,
  implied,
});
const base = (ts: number, over: Partial<BreakerInput> = {}): BreakerInput => ({
  ts,
  window: 'B',
  sigma: 0.001,
  sources: [tg(100), adr(100)],
  tradegateScheduled: true,
  primaryHalted: false,
  mark: 10_000n,
  bandLo: 9_900n,
  bandHi: 10_100n,
  ...over,
});
const run = (b: MarketBreakers, from: number, to: number, over: Partial<BreakerInput>) => {
  let out = b.evaluate(base(from, over));
  for (let t = from + S; t <= to; t += S) out = b.evaluate(base(t, over));
  return out;
};

describe('MarketBreakers', () => {
  it('is quiet in normal conditions', () => {
    expect(run(new MarketBreakers(params), T0, T0 + 120 * S, {})).toMatchObject({
      active: [],
      effect: 'none',
    });
  });

  it('CB1: ADR vs Tradegate divergence > 3σ for 60 s → no new opens, with change events', () => {
    const b = new MarketBreakers(params);
    const div = { sources: [tg(100), adr(100.5)] }; // 50 bp vs 3σ = 30 bp
    expect(run(b, T0, T0 + 59 * S, div).active).toEqual([]);
    const on = b.evaluate(base(T0 + 60 * S, div));
    expect(on).toMatchObject({
      active: ['CB1'],
      effect: 'no-opens',
      changes: [{ id: 'CB1', active: true }],
    });
    run(b, T0 + 61 * S, T0 + 120 * S, {});
    expect(b.evaluate(base(T0 + 121 * S)).active).toEqual([]);
  });

  it('CB2: primary halt → reduce-only immediately', () => {
    expect(new MarketBreakers(params).evaluate(base(T0, { primaryHalted: true })).effect).toBe(
      'reduce-only',
    );
  });

  it('CB3: index stale > 15 s in Window A → degraded; Window B tolerates 120 s', () => {
    const b = new MarketBreakers(params);
    b.evaluate(base(T0, { window: 'A' }));
    expect(
      b.evaluate(base(T0 + 16 * S, { window: 'A', sources: [], tradegateScheduled: false })).active,
    ).toEqual(['CB3']);
    const c = new MarketBreakers(params);
    c.evaluate(base(T0));
    expect(
      c.evaluate(base(T0 + 100 * S, { sources: [], tradegateScheduled: false })).active,
    ).toEqual([]);
  });

  it('ADR-0008: Tradegate stale > 5 min → reduce-only; released after 2 min fresh', () => {
    const b = new MarketBreakers(params);
    const stale = { sources: [adr(100)] };
    expect(run(b, T0, T0 + 299 * S, stale).active).not.toContain('CB3-TG');
    expect(b.evaluate(base(T0 + 300 * S, stale))).toMatchObject({ effect: 'reduce-only' });
    expect(run(b, T0 + 301 * S, T0 + 420 * S, {}).active).toContain('CB3-TG');
    expect(b.evaluate(base(T0 + 421 * S)).active).toEqual([]);
  });

  it('CB8: mark pinned at a band edge > 60 s → degraded; clears after 60 s inside', () => {
    const b = new MarketBreakers(params);
    const pinned = { mark: 10_100n };
    run(b, T0, T0 + 60 * S, pinned);
    expect(b.evaluate(base(T0 + 61 * S, pinned)).active).toEqual(['CB8']);
    expect(run(b, T0 + 62 * S, T0 + 122 * S, {}).active).toEqual([]);
  });

  it('global breakers merge in and the strongest effect wins', () => {
    const out = new MarketBreakers(params).evaluate(base(T0, { sources: [tg(100), adr(100.5)] }), [
      'CB4',
    ]);
    expect(out).toMatchObject({ active: ['CB4'], effect: 'reduce-only' });
  });
});

describe('BasketDrawdownBreaker (CB4)', () => {
  it('fires at −7 % vs the anchor for 15 min, once per anchor', () => {
    const b = new BasketDrawdownBreaker(params);
    const anchor = { price: 1000, ts: T0 };
    expect(b.evaluate(T0, 940, anchor)).toEqual([]);
    expect(b.evaluate(T0 + S, 930, anchor)).toEqual(['CB4']);
    expect(b.evaluate(T0 + 899 * S, 900, anchor)).toEqual(['CB4']);
    expect(b.evaluate(T0 + 902 * S, 900, anchor)).toEqual([]); // same anchor: no re-fire
    expect(b.evaluate(T0 + 903 * S, 900, { price: 1000, ts: T0 + 1 })).toEqual(['CB4']); // new anchor
  });
});
