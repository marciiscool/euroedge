import { describe, expect, it } from 'vitest';
import type { FvParams, Tick } from '@euroedge/shared';
import { FvModel } from './model.ts';
import { toEngineUpdate } from './engine-update.ts';

const params: FvParams = {
  signalSigmaBp: { tradegate: { A: 8, B: 12, C: 25, D: 40 }, adr: { A: 15, B: 20, C: 35, D: 50 } },
  stalenessBp2PerSecond: 0.5,
  phi: 1.2,
  sigmaFloorBp: { A: 5, B: 10, C: 20, D: 30 },
  widenBp2PerHour: { A: 25, B: 100, C: 400, D: 900 },
  tradegateMaxSpreadBp: 30,
  maxSignalAgeSeconds: 60,
  bandSigmas: 2.5,
  confidenceBp: { high: 25, medium: 75 },
  basisHalfLifeDays: 20,
  dkkPeg: { central: 7.46038, alertBp: 50 },
  breakers: {
    divergenceSigmas: 3,
    divergenceSeconds: 60,
    indexStaleSeconds: { A: 15, B: 120, C: 120, D: 120 },
    tradegateStaleEscalationSeconds: 300,
    tradegateReleaseSeconds: 120,
    basketDrawdownBp: 700,
    basketCooldownSeconds: 900,
    markPinnedSeconds: 60,
  },
  snap: { capSuspendSeconds: 60, outsideBandReduceOnlySeconds: 300 },
};
const T0 = 1_793_000_000_000;
const model = () =>
  new FvModel({
    primary: { venue: 'XAMS', symbol: 'ASML' },
    tradegate: { venue: 'TGAT', symbol: 'ASML' },
    adr: { ref: { venue: 'XNAS', symbol: 'ASML' }, verified: true },
    fx: { venue: 'FX', symbol: 'EURUSD' },
    params,
  });
const tick = (
  venue: Tick['instrument']['venue'],
  ts: number,
  kind: Tick['kind'],
  px: Partial<Tick>,
): Tick => ({
  source: 'sim',
  instrument: { venue, symbol: venue === 'FX' ? 'EURUSD' : 'ASML' },
  ts,
  currency: venue === 'XNAS' || venue === 'FX' ? 'USD' : 'EUR',
  kind,
  ...px,
});

function anchored() {
  const m = model();
  m.onTick(tick('XAMS', T0, 'close', { last: 700 }));
  m.onTick(tick('XNAS', T0, 'close', { last: 756 })); // same t_C → becomes the ADR reference
  m.onTick(tick('FX', T0, 'close', { last: 1.08 }));
  return m;
}

describe('FvModel', () => {
  it('returns nothing before the first anchor', () => {
    expect(model().evaluate(T0, { window: 'B', adrLive: true })).toBeUndefined();
  });

  it('starts at C with confidence none until a signal arrives', () => {
    const snap = anchored().evaluate(T0 + 1000, { window: 'C', adrLive: false });
    expect(snap?.fv).toBe(700);
    expect(snap?.confidence).toBe('none');
    expect(snap?.sigma).toBeCloseTo(20e-4, 12);
  });

  it('follows Tradegate alone in Window B', () => {
    const m = anchored();
    m.onTick(tick('TGAT', T0 + 5000, 'quote', { bid: 706.9, ask: 707.1 }));
    const snap = m.evaluate(T0 + 5000, { window: 'B', adrLive: false });
    expect(snap?.fv).toBeCloseTo(707, 9);
    expect(snap?.sources.map((s) => [s.kind, s.weight])).toEqual([['tradegate', 1]]);
    expect(snap?.index).toBe(snap?.fv);
    expect(snap?.bandLo).toBeLessThan(707);
    expect(snap?.bandHi).toBeGreaterThan(707);
  });

  it('ignores wide or stale Tradegate quotes', () => {
    const m = anchored();
    m.onTick(tick('TGAT', T0 + 5000, 'quote', { bid: 690, ask: 710 })); // ≈ 287 bp wide
    expect(m.evaluate(T0 + 5000, { window: 'B', adrLive: false })?.sources).toEqual([]);
    const m2 = anchored();
    m2.onTick(tick('TGAT', T0 + 5000, 'quote', { bid: 706.9, ask: 707.1 }));
    expect(m2.evaluate(T0 + 70_000, { window: 'B', adrLive: false })?.sources).toEqual([]);
  });

  it('uses the ADR in return form, net of EUR/USD, only while its venue is live', () => {
    const m = anchored();
    // ADR +2 %, EUR/USD +1 % → s_A = ln(1.02) − ln(1.01)
    m.onTick(tick('XNAS', T0 + 3000, 'quote', { bid: 771.12, ask: 771.12 }));
    m.onTick(tick('FX', T0 + 3000, 'quote', { bid: 1.0908, ask: 1.0908 }));
    const live = m.evaluate(T0 + 3000, { window: 'B', adrLive: true });
    expect(live?.fv).toBeCloseTo(700 * (1.02 / 1.01), 6);
    expect(live?.sources[0]?.kind).toBe('adr');
    const closed = m.evaluate(T0 + 4000, { window: 'C', adrLive: false });
    expect(closed?.sources).toEqual([]);
  });

  it('holds FV and widens σ while no signal is live (q accumulates per window)', () => {
    const m = anchored();
    m.onTick(tick('TGAT', T0 + 1000, 'quote', { bid: 706.9, ask: 707.1 }));
    const live = m.evaluate(T0 + 1000, { window: 'B', adrLive: false });
    const later = m.evaluate(T0 + 1000 + 4 * 3_600_000, { window: 'C', adrLive: false });
    expect(later?.fv).toBe(live?.fv);
    const expected = Math.sqrt((live?.sigma ?? 0) ** 2 + 400e-8 * 4);
    expect(later?.sigma).toBeCloseTo(Math.max(expected, 20e-4), 12);
    expect(later?.confidence).not.toBe('none');
  });

  it('Window A index = median{primary, Tradegate, FV}; Tradegate alone without a fresh primary', () => {
    const m = anchored();
    m.onTick(tick('TGAT', T0 + 1000, 'quote', { bid: 704.9, ask: 705.1 }));
    m.onTick(tick('XAMS', T0 + 1000, 'trade', { last: 703 }));
    const a = m.evaluate(T0 + 1000, { window: 'A', adrLive: false });
    // FV = 705 (Tradegate only) → median{703, 705, 705} = 705
    expect(a?.index).toBeCloseTo(705, 9);
    const m2 = anchored();
    m2.onTick(tick('TGAT', T0 + 1000, 'quote', { bid: 704.9, ask: 705.1 }));
    expect(m2.evaluate(T0 + 1000, { window: 'A', adrLive: false })?.index).toBeCloseTo(705, 9);
  });

  it('re-anchors on the official close and keeps the ADR reference at t_C', () => {
    const m = anchored();
    m.onTick(tick('XNAS', T0 + 10_000, 'quote', { bid: 760, ask: 760 }));
    m.onTick(tick('FX', T0 + 10_000, 'quote', { bid: 1.08, ask: 1.08 }));
    m.onTick(tick('XAMS', T0 + 10_000, 'close', { last: 702 }));
    m.onTick(tick('XNAS', T0 + 20_000, 'quote', { bid: 760, ask: 760 }));
    const snap = m.evaluate(T0 + 20_000, { window: 'B', adrLive: true });
    expect(snap?.anchor.price).toBe(702);
    expect(snap?.fv).toBeCloseTo(702, 9); // ADR unchanged since t_C
  });

  it('quantizes at the boundary with an outward band and a capped mark', () => {
    const m = anchored();
    m.onTick(tick('TGAT', T0 + 1000, 'quote', { bid: 706.9, ask: 707.1 }));
    const snap = m.evaluate(T0 + 1000, { window: 'B', adrLive: false });
    if (snap === undefined) throw new Error('no snapshot');
    const u = toEngineUpdate(snap, {
      tickSize: 0.01,
      prevMark: 70_000n,
      dtMs: 1000,
      stepCapBpsPerSecond: 50,
    });
    expect(u.fv).toBe(70_700n);
    expect(u.bandLo <= u.fv && u.fv <= u.bandHi).toBe(true);
    // 700 → 707 is 100 bp: the step cap allows 350 ticks, but the band (707 ± ~0.4 %) wins.
    expect(u.mark).toBe(u.bandLo);
    expect(u.markClamped).toBe(true);
    expect(u.sigmaPpm).toBeGreaterThan(0n);
  });
});
