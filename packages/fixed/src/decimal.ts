import { divRound, pow10, type Rounding } from './rounding.ts';

const DECIMAL = /^(-)?(\d+)(?:\.(\d+))?$/;

/** A decimal string as an exact rational `num / 10^decimals`. */
export interface DecimalParts {
  readonly num: bigint;
  readonly decimals: number;
}

export function decimalParts(s: string): DecimalParts {
  const m = DECIMAL.exec(s);
  if (m === null) throw new SyntaxError(`invalid decimal "${s}"`);
  const [, minus, int = '', frac = ''] = m;
  const num = BigInt(int + frac);
  return { num: minus === undefined ? num : -num, decimals: frac.length };
}

/**
 * Parses a decimal string into an integer at `scale` decimals ("1.5", 6 → 1500000n).
 * Throws on precision loss unless a rounding mode is given.
 */
export function parseDecimal(s: string, scale: number, mode?: Rounding): bigint {
  const { num, decimals } = decimalParts(s);
  if (decimals <= scale) return num * pow10(scale - decimals);
  if (mode === undefined) {
    throw new RangeError(`"${s}" has more than ${scale} decimals; pass a rounding mode`);
  }
  return divRound(num, pow10(decimals - scale), mode);
}

/** Formats an integer at `scale` decimals as a decimal string (1500000n, 6 → "1.500000"). */
export function formatDecimal(v: bigint, scale: number, opts: { trim?: boolean } = {}): string {
  const negative = v < 0n;
  const digits = (negative ? -v : v).toString().padStart(scale + 1, '0');
  const int = digits.slice(0, digits.length - scale);
  let frac = digits.slice(digits.length - scale);
  if (opts.trim === true) frac = frac.replace(/0+$/, '');
  return `${negative ? '-' : ''}${int}${frac.length > 0 ? `.${frac}` : ''}`;
}
