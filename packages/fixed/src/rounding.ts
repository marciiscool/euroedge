/**
 * Explicit rounding modes. Every lossy operation names one (ADR-0002):
 * fees use `ceil`, PnL/funding pro-rata use `trunc` (residue to the fee account).
 */
export type Rounding = 'floor' | 'ceil' | 'trunc' | 'away' | 'halfEven';

export const abs = (v: bigint): bigint => (v < 0n ? -v : v);
export const min = (a: bigint, b: bigint): bigint => (a < b ? a : b);
export const max = (a: bigint, b: bigint): bigint => (a > b ? a : b);
export const clamp = (v: bigint, lo: bigint, hi: bigint): bigint => {
  if (lo > hi) throw new RangeError(`clamp: lo ${lo} > hi ${hi}`);
  return v < lo ? lo : v > hi ? hi : v;
};
export const sign = (v: bigint): -1n | 0n | 1n => (v < 0n ? -1n : v > 0n ? 1n : 0n);

/** Exact integer division n / d with the given rounding mode. */
export function divRound(n: bigint, d: bigint, mode: Rounding): bigint {
  if (d === 0n) throw new RangeError('division by zero');
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const q = n / d; // truncates toward zero
  const r = n % d; // has the sign of n
  if (r === 0n) return q;
  const negative = n < 0n;
  const awayFromZero = negative ? q - 1n : q + 1n;
  switch (mode) {
    case 'trunc':
      return q;
    case 'floor':
      return negative ? q - 1n : q;
    case 'ceil':
      return negative ? q : q + 1n;
    case 'away':
      return awayFromZero;
    case 'halfEven': {
      const twice = 2n * abs(r);
      if (twice < d) return q;
      if (twice > d) return awayFromZero;
      return q % 2n === 0n ? q : awayFromZero;
    }
  }
}

/** Exact (a · b) / d with the given rounding mode; no intermediate overflow (bigint). */
export function mulDiv(a: bigint, b: bigint, d: bigint, mode: Rounding): bigint {
  return divRound(a * b, d, mode);
}

/**
 * (a · b) / d truncated toward zero, plus the remainder numerator, so callers can route the
 * residue explicitly: `q · d + rem === a · b`.
 */
export function mulDivRem(a: bigint, b: bigint, d: bigint): { q: bigint; rem: bigint } {
  if (d === 0n) throw new RangeError('division by zero');
  const n = a * b;
  return { q: n / d, rem: n % d };
}

/** ⌊√n⌋ for n ≥ 0 (Newton's method on bigints, exact). */
export function isqrt(n: bigint): bigint {
  if (n < 0n) throw new RangeError('isqrt of a negative number');
  if (n < 2n) return n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
}

/** ⌈√n⌉ for n ≥ 0. */
export function isqrtCeil(n: bigint): bigint {
  const r = isqrt(n);
  return r * r === n ? r : r + 1n;
}

export const pow10 = (k: number): bigint => {
  if (!Number.isSafeInteger(k) || k < 0) throw new RangeError(`pow10: invalid exponent ${k}`);
  return 10n ** BigInt(k);
};
