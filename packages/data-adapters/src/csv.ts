import { tickSchema, type Tick } from '@euroedge/shared';

/** Column order of the tick CSV format (docs/data-format.md). */
export const CSV_COLUMNS = [
  'ts',
  'source',
  'venue',
  'symbol',
  'kind',
  'currency',
  'bid',
  'ask',
  'last',
  'size',
] as const;
export const CSV_HEADER = CSV_COLUMNS.join(',');

const num = (v: number | undefined) => (v === undefined ? '' : String(v));

/** One CSV line (no newline). Symbols never contain commas or quotes (validated on read). */
export function tickToCsv(t: Tick): string {
  return [
    new Date(t.ts).toISOString(),
    t.source,
    t.instrument.venue,
    t.instrument.symbol,
    t.kind,
    t.currency,
    num(t.bid),
    num(t.ask),
    num(t.last),
    num(t.size),
  ].join(',');
}

export class CsvFormatError extends Error {
  constructor(line: number, message: string) {
    super(`line ${line}: ${message}`);
    this.name = 'CsvFormatError';
  }
}

const opt = (v: string | undefined) => (v === undefined || v === '' ? undefined : Number(v));

/** Parses a tick CSV (header required). Rows must be in non-decreasing time order. */
export function parseTickCsv(text: string): Tick[] {
  const lines = text.split(/\r?\n/);
  if (lines[0] !== CSV_HEADER) throw new CsvFormatError(1, `expected header "${CSV_HEADER}"`);
  const out: Tick[] = [];
  let prev = -Infinity;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined || line === '') continue;
    const c = line.split(',');
    if (c.length !== CSV_COLUMNS.length)
      throw new CsvFormatError(i + 1, `expected ${CSV_COLUMNS.length} columns`);
    const [ts, source, venue, symbol, kind, currency, bid, ask, last, size] = c;
    const raw = {
      source,
      instrument: { venue, symbol },
      ts: Date.parse(ts ?? ''),
      currency,
      kind,
      ...(opt(bid) === undefined ? {} : { bid: opt(bid) }),
      ...(opt(ask) === undefined ? {} : { ask: opt(ask) }),
      ...(opt(last) === undefined ? {} : { last: opt(last) }),
      ...(opt(size) === undefined ? {} : { size: opt(size) }),
    };
    const parsed = tickSchema.safeParse(raw);
    if (!parsed.success)
      throw new CsvFormatError(i + 1, parsed.error.issues[0]?.message ?? 'invalid tick');
    if (parsed.data.ts < prev) throw new CsvFormatError(i + 1, 'rows must be sorted by ts');
    prev = parsed.data.ts;
    out.push(parsed.data);
  }
  return out;
}
