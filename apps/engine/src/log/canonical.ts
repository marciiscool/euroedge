/**
 * Canonical JSON (RFC 8785-style): object keys sorted by UTF-16 code units, no whitespace,
 * bigints as decimal strings, only safe integers allowed as numbers (no floats can enter
 * the log), undefined rejected. The same value always yields the same bytes.
 */
export function canonicalJson(value: unknown): string {
  switch (typeof value) {
    case 'bigint':
      return JSON.stringify(value.toString());
    case 'number':
      if (!Number.isSafeInteger(value))
        throw new TypeError(`non-integer number in canonical JSON: ${value}`);
      return String(value);
    case 'string':
      return JSON.stringify(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'object': {
      if (value === null) return 'null';
      if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
      if (value instanceof Map || value instanceof Set || value instanceof Date) {
        throw new TypeError('convert Map/Set/Date before canonical encoding');
      }
      const entries = Object.entries(value as Record<string, unknown>);
      for (const [k, v] of entries)
        if (v === undefined) throw new TypeError(`undefined at key "${k}"`);
      entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
    }
    default:
      throw new TypeError(`cannot canonicalize ${typeof value}`);
  }
}

export const canonicalBytes = (value: unknown): Buffer => Buffer.from(canonicalJson(value), 'utf8');
