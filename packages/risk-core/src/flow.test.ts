import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { RATE_SCALE } from '@euroedge/fixed';
import { cappedFlow, decayFlow, flowDecayFactor, flowShiftPpm } from './flow.ts';

describe('flow shift (ADR-0019)', () => {
  it('decays by (1 − 1/τ) per second, composably and monotonically', () => {
    expect(flowDecayFactor(300n, 0n)).toBe(RATE_SCALE);
    expect(flowDecayFactor(300n, 1n)).toBe(RATE_SCALE - RATE_SCALE / 300n);
    expect(flowDecayFactor(1n, 5n)).toBe(0n);
    // ≈ e^{-1} after τ seconds: 0.99666…^300 = 0.3673…
    const f = flowDecayFactor(300n, 300n);
    expect(f > 367_000_000_000_000_000n && f < 368_000_000_000_000_000n).toBe(true);
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 100_000n }),
        fc.bigInt({ min: 0n, max: 100n }),
        (a, d) => {
          expect(flowDecayFactor(300n, a + d) <= flowDecayFactor(300n, a)).toBe(true);
        },
      ),
    );
    expect(decayFlow(-1_000_000n, 300n, 0n)).toBe(-1_000_000n);
    expect(decayFlow(-1_000_000n, 300n, 1n)).toBe(-996_666n); // truncated toward zero
    expect(() => flowDecayFactor(0n, 1n)).toThrow(RangeError);
    expect(() => flowDecayFactor(5n, -1n)).toThrow(RangeError);
  });

  it('κ is ppm per 1 M USDC of net flow', () => {
    expect(flowShiftPpm(1_000_000_000_000n, 100n)).toBe(100n);
    expect(flowShiftPpm(-2_500_000_000_000n, 100n)).toBe(-250n);
    expect(flowShiftPpm(9_999n, 100n)).toBe(0n);
  });

  it('caps what one wallet adds per window', () => {
    expect(cappedFlow(300n, 0n, 1_000n)).toEqual({ counted: 300n, used: 300n });
    expect(cappedFlow(-900n, 300n, 1_000n)).toEqual({ counted: -700n, used: 1_000n });
    expect(cappedFlow(50n, 1_000n, 1_000n)).toEqual({ counted: 0n, used: 1_000n });
  });
});
