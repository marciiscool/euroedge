import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { band, combine, confidenceOf, median3, widenSigma, type Signal } from './combine.ts';

const P = { stalenessBp2PerSecond: 0.5, phi: 1.2, sigmaFloorBp: 5 };
const sig = (kind: Signal['kind'], s: number, sigmaBp: number, ageSeconds = 0): Signal => ({
  kind,
  s,
  sigmaBp,
  ageSeconds,
});

describe('combine — hand-computed vector (fv.yaml Window A seeds)', () => {
  // v_T = 8² = 64, v_A = 15² = 225 (age 0) → w_T = 225/289, w_A = 64/289
  // σ_FV = 1.2 · sqrt(1 / (1/64 + 1/225)) = 1.2 · sqrt(14400/289) = 8.47059 bp
  it('weights, ŝ and σ_FV', () => {
    const c = combine([sig('tradegate', 0.01, 8), sig('adr', 0.02, 15)], P);
    expect(c?.signals[0]?.weight).toBeCloseTo(225 / 289, 12);
    expect(c?.signals[1]?.weight).toBeCloseTo(64 / 289, 12);
    expect(c?.s).toBeCloseTo((225 * 0.01 + 64 * 0.02) / 289, 12);
    expect((c?.sigma ?? 0) * 1e4).toBeCloseTo(1.2 * Math.sqrt(14_400 / 289), 9);
  });

  it('adds λ·age to the variance', () => {
    // v_T = 64 + 0.5 · 30 = 79 → σ_FV = 1.2 · sqrt(79) bp (single signal)
    const c = combine([sig('tradegate', 0, 8, 30)], P);
    expect((c?.sigma ?? 0) * 1e4).toBeCloseTo(1.2 * Math.sqrt(79), 9);
  });

  it('applies the σ floor and returns undefined without signals', () => {
    expect((combine([sig('tradegate', 0, 1)], P)?.sigma ?? 0) * 1e4).toBe(5);
    expect(combine([], P)).toBeUndefined();
    expect(() => combine([sig('adr', 0, 0)], P)).toThrow(/non-positive variance/);
  });
});

describe('combine — properties', () => {
  const signal = fc.record({
    kind: fc.constantFrom('tradegate', 'adr'),
    s: fc.double({ min: -0.2, max: 0.2, noNaN: true }),
    sigmaBp: fc.double({ min: 1, max: 100, noNaN: true }),
    ageSeconds: fc.double({ min: 0, max: 120, noNaN: true }),
  });

  it('weights sum to 1; ŝ lies within the signals; σ ≥ floor', () => {
    fc.assert(
      fc.property(fc.array(signal, { minLength: 1, maxLength: 4 }), (sigs) => {
        const c = combine(sigs, P);
        expect(c).toBeDefined();
        const ws = c?.signals.map((x) => x.weight) ?? [];
        expect(ws.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
        const ss = sigs.map((x) => x.s);
        expect(c?.s ?? NaN).toBeGreaterThanOrEqual(Math.min(...ss) - 1e-12);
        expect(c?.s ?? NaN).toBeLessThanOrEqual(Math.max(...ss) + 1e-12);
        expect(c?.sigma ?? 0).toBeGreaterThanOrEqual(P.sigmaFloorBp * 1e-4 - 1e-15);
      }),
    );
  });

  it('an extra signal never increases σ (before the floor)', () => {
    const noFloor = { ...P, sigmaFloorBp: 0 };
    fc.assert(
      fc.property(fc.array(signal, { minLength: 1, maxLength: 3 }), signal, (sigs, extra) => {
        const a = combine(sigs, noFloor)?.sigma ?? 0;
        const b = combine([...sigs, extra], noFloor)?.sigma ?? 0;
        expect(b).toBeLessThanOrEqual(a + 1e-15);
      }),
    );
  });
});

describe('helpers', () => {
  it('widens σ with time and is monotone', () => {
    // σ_last = 10 bp, q = 100 bp²/h, 3 h → sqrt(100 + 300) = 20 bp
    expect(widenSigma(10e-4, 100, 3 * 3_600_000) * 1e4).toBeCloseTo(20, 9);
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1e8 }), fc.integer({ min: 0, max: 1e8 }), (a, b) => {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        expect(widenSigma(1e-3, 400, lo)).toBeLessThanOrEqual(widenSigma(1e-3, 400, hi));
      }),
    );
  });

  it('band contains FV and is symmetric in log space', () => {
    const [lo, hi] = band(700, 0.001, 2.5);
    expect(lo).toBeLessThan(700);
    expect(hi).toBeGreaterThan(700);
    expect(Math.log(700 / lo)).toBeCloseTo(Math.log(hi / 700), 12);
  });

  it('confidence thresholds', () => {
    expect(confidenceOf(20e-4, { high: 25, medium: 75 })).toBe('high');
    expect(confidenceOf(50e-4, { high: 25, medium: 75 })).toBe('medium');
    expect(confidenceOf(80e-4, { high: 25, medium: 75 })).toBe('low');
  });

  it('median3 is the middle value in every order', () => {
    for (const [a, b, c] of [
      [1, 2, 3],
      [3, 1, 2],
      [2, 3, 1],
      [2, 2, 1],
    ] as const) {
      expect(median3(a, b, c)).toBe([a, b, c].sort((x, y) => x - y)[1]);
    }
  });
});
