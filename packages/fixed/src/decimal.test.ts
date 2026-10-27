import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { decimalParts, formatDecimal, parseDecimal } from './decimal.ts';

describe('parseDecimal', () => {
  it.each([
    ['1.5', 6, 1_500_000n],
    ['0.000001', 6, 1n],
    ['-12.34', 2, -1234n],
    ['7', 0, 7n],
    ['0', 4, 0n],
    ['00012.10', 2, 1210n],
  ] as const)('%s @%i → %s', (s, scale, expected) => {
    expect(parseDecimal(s, scale)).toBe(expected);
  });

  it('refuses silent precision loss', () => {
    expect(() => parseDecimal('1.2345', 2)).toThrow(/rounding mode/);
    expect(parseDecimal('1.2345', 2, 'floor')).toBe(123n);
    expect(parseDecimal('1.2351', 2, 'ceil')).toBe(124n);
    expect(parseDecimal('-1.2345', 2, 'trunc')).toBe(-123n);
  });

  it.each(['', '1.', '.5', '1e6', '+1', '1,5', ' 1', 'NaN'])('rejects "%s"', (s) => {
    expect(() => parseDecimal(s, 2)).toThrow(SyntaxError);
  });

  it('decimalParts keeps the exact rational', () => {
    expect(decimalParts('-0.050')).toEqual({ num: -50n, decimals: 3 });
  });
});

describe('formatDecimal', () => {
  it.each([
    [1_500_000n, 6, '1.500000'],
    [-1n, 6, '-0.000001'],
    [1234n, 0, '1234'],
    [5n, 2, '0.05'],
  ] as const)('%s @%i → %s', (v, scale, expected) => {
    expect(formatDecimal(v, scale)).toBe(expected);
  });

  it('trims trailing zeros on request', () => {
    expect(formatDecimal(1_500_000n, 6, { trim: true })).toBe('1.5');
    expect(formatDecimal(2_000_000n, 6, { trim: true })).toBe('2');
  });

  it('round-trips with parseDecimal (property)', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -(10n ** 40n), max: 10n ** 40n }),
        fc.integer({ min: 0, max: 24 }),
        (v, scale) => {
          expect(parseDecimal(formatDecimal(v, scale), scale)).toBe(v);
        },
      ),
    );
  });
});
