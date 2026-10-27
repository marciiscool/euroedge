import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { stepMark } from './mark.ts';
import { toTicks, toTicksCeil, toTicksFloor } from './quantize.ts';

describe('stepMark (ADR-0009)', () => {
  const base = { bandLo: 69_000n, bandHi: 71_000n, dtMs: 1000, stepCapBpsPerSecond: 50 };

  it('first update takes the target (clamped to the band)', () => {
    expect(stepMark({ ...base, prev: undefined, target: 70_500n })).toEqual({
      mark: 70_500n,
      clamped: false,
    });
    expect(stepMark({ ...base, prev: undefined, target: 75_000n })).toEqual({
      mark: 71_000n,
      clamped: true,
    });
  });

  it('caps the step at 50 bp/s: 70 000 ticks → max 350 ticks per second', () => {
    expect(stepMark({ ...base, prev: 70_000n, target: 70_900n })).toEqual({
      mark: 70_350n,
      clamped: false,
    });
    expect(stepMark({ ...base, prev: 70_000n, target: 70_900n, dtMs: 2000 })).toEqual({
      mark: 70_700n,
      clamped: false,
    });
  });

  it('the band dominates the step cap', () => {
    // Band jumped up: the capped step would leave the mark below the band → clamped to bandLo.
    expect(
      stepMark({ ...base, prev: 68_000n, target: 70_000n, bandLo: 69_500n, bandHi: 70_500n }),
    ).toEqual({ mark: 69_500n, clamped: true });
  });

  it('suspends the cap during SNAP', () => {
    expect(stepMark({ ...base, prev: 70_000n, target: 70_900n, suspendStepCap: true }).mark).toBe(
      70_900n,
    );
  });

  it('always stays inside the band; moves ≤ cap unless the band forced it (property)', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1_000n, max: 10_000_000n }),
        fc.bigInt({ min: 1_000n, max: 10_000_000n }),
        fc.bigInt({ min: 1_000n, max: 10_000_000n }),
        fc.bigInt({ min: 0n, max: 100_000n }),
        fc.integer({ min: 0, max: 10_000 }),
        (prev, target, lo, width, dtMs) => {
          const r = stepMark({ ...base, prev, target, bandLo: lo, bandHi: lo + width, dtMs });
          expect(r.mark >= lo && r.mark <= lo + width).toBe(true);
          const maxStep = (prev * 50n * BigInt(dtMs) + 9_999_999n) / 10_000_000n || 1n;
          const moved = r.mark > prev ? r.mark - prev : prev - r.mark;
          if (!r.clamped) expect(moved <= maxStep).toBe(true);
        },
      ),
    );
  });

  it('rejects an inverted band', () => {
    expect(() => stepMark({ ...base, prev: 1n, target: 1n, bandLo: 2n, bandHi: 1n })).toThrow();
  });
});

describe('quantize', () => {
  it('rounds to the nearest tick, ties to even, despite float noise', () => {
    expect(toTicks(712.35, 0.01)).toBe(71_235n);
    expect(toTicks(700.005, 0.01)).toBe(70_000n);
    expect(toTicks(700.015, 0.01)).toBe(70_002n);
    expect(toTicks(700.0149, 0.01)).toBe(70_001n);
    expect(() => toTicks(0, 0.01)).toThrow();
    expect(() => toTicks(Number.NaN, 0.01)).toThrow();
  });

  it('band edges round outward', () => {
    expect(toTicksFloor(700.019, 0.01)).toBe(70_001n);
    expect(toTicksCeil(700.011, 0.01)).toBe(70_002n);
    expect(toTicksFloor(700.01, 0.01)).toBe(70_001n);
    expect(toTicksCeil(700.01, 0.01)).toBe(70_001n);
  });
});
