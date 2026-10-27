import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { abs, clamp, divRound, max, min, mulDiv, mulDivRem, pow10, sign } from './rounding.ts';

const big = fc.bigInt({ min: -(10n ** 30n), max: 10n ** 30n });
const nonZero = big.filter((d) => d !== 0n);

describe('divRound (exact table)', () => {
  // n/d = 7/2 = 3.5, -7/2 = -3.5, 5/2 = 2.5, 7/3 = 2.33…, -7/3 = -2.33…
  it.each([
    [7n, 2n, { floor: 3n, ceil: 4n, trunc: 3n, away: 4n, halfEven: 4n }],
    [-7n, 2n, { floor: -4n, ceil: -3n, trunc: -3n, away: -4n, halfEven: -4n }],
    [5n, 2n, { floor: 2n, ceil: 3n, trunc: 2n, away: 3n, halfEven: 2n }],
    [-5n, 2n, { floor: -3n, ceil: -2n, trunc: -2n, away: -3n, halfEven: -2n }],
    [7n, 3n, { floor: 2n, ceil: 3n, trunc: 2n, away: 3n, halfEven: 2n }],
    [-7n, 3n, { floor: -3n, ceil: -2n, trunc: -2n, away: -3n, halfEven: -2n }],
    [8n, -3n, { floor: -3n, ceil: -2n, trunc: -2n, away: -3n, halfEven: -3n }],
    [6n, 3n, { floor: 2n, ceil: 2n, trunc: 2n, away: 2n, halfEven: 2n }],
  ] as const)('%s / %s', (n, d, expected) => {
    for (const [mode, q] of Object.entries(expected)) {
      expect(divRound(n, d, mode as keyof typeof expected), mode).toBe(q);
    }
  });

  it('throws on division by zero', () => {
    expect(() => divRound(1n, 0n, 'floor')).toThrow(RangeError);
    expect(() => mulDivRem(1n, 1n, 0n)).toThrow(RangeError);
  });
});

describe('divRound (properties)', () => {
  it('floor and ceil bracket the exact quotient', () => {
    fc.assert(
      fc.property(big, nonZero, (n, d) => {
        const ad = abs(d);
        const nn = d < 0n ? -n : n; // n/d === nn/ad
        const f = divRound(n, d, 'floor');
        const c = divRound(n, d, 'ceil');
        expect(f * ad <= nn && nn < (f + 1n) * ad).toBe(true);
        expect((c - 1n) * ad < nn && nn <= c * ad).toBe(true);
        expect(c - f === 0n || c - f === 1n).toBe(true);
      }),
    );
  });

  it('trunc moves toward zero, away moves away from zero', () => {
    fc.assert(
      fc.property(big, nonZero, (n, d) => {
        const exactSign = sign(n) * sign(d);
        const t = divRound(n, d, 'trunc');
        const a = divRound(n, d, 'away');
        expect(abs(t * d) <= abs(n)).toBe(true);
        expect(abs(a * d) >= abs(n)).toBe(true);
        if (t !== 0n) expect(sign(t)).toBe(exactSign);
        if (n !== 0n) expect(sign(a)).toBe(exactSign);
      }),
    );
  });

  it('halfEven is nearest, ties to even', () => {
    fc.assert(
      fc.property(big, nonZero, (n, d) => {
        const q = divRound(n, d, 'halfEven');
        const err2 = 2n * abs(n - q * d);
        expect(err2 <= abs(d)).toBe(true);
        if (err2 === abs(d)) expect(q % 2n).toBe(0n);
      }),
    );
  });

  it('mulDivRem reconstructs the product', () => {
    fc.assert(
      fc.property(big, big, nonZero, (a, b, d) => {
        const { q, rem } = mulDivRem(a, b, d);
        expect(q * d + rem).toBe(a * b);
        expect(q).toBe(mulDiv(a, b, d, 'trunc'));
      }),
    );
  });
});

describe('helpers', () => {
  it('abs/min/max/sign/clamp', () => {
    expect(abs(-3n)).toBe(3n);
    expect(min(2n, -1n)).toBe(-1n);
    expect(max(2n, -1n)).toBe(2n);
    expect([sign(-5n), sign(0n), sign(9n)]).toEqual([-1n, 0n, 1n]);
    expect(clamp(5n, 0n, 3n)).toBe(3n);
    expect(clamp(-5n, 0n, 3n)).toBe(0n);
    expect(clamp(2n, 0n, 3n)).toBe(2n);
    expect(() => clamp(1n, 3n, 0n)).toThrow(RangeError);
  });

  it('pow10', () => {
    expect(pow10(0)).toBe(1n);
    expect(pow10(18)).toBe(1_000_000_000_000_000_000n);
    expect(() => pow10(-1)).toThrow(RangeError);
    expect(() => pow10(1.5)).toThrow(RangeError);
  });
});
