import { describe, expect, it } from 'vitest';
import { instrumentKey, tickSchema } from './market-data.ts';

describe('tickSchema', () => {
  const base = {
    source: 'sim',
    instrument: { venue: 'TGAT', symbol: 'ASML' },
    ts: 1_793_000_000_000,
    currency: 'EUR',
    kind: 'quote',
  } as const;

  it('accepts a quote and a trade', () => {
    expect(tickSchema.parse({ ...base, bid: 700.1, ask: 700.3 }).bid).toBe(700.1);
    expect(tickSchema.parse({ ...base, kind: 'trade', last: 700.2, size: 10 }).last).toBe(700.2);
  });

  it('rejects non-positive prices and fractional timestamps', () => {
    expect(() => tickSchema.parse({ ...base, bid: 0 })).toThrow();
    expect(() => tickSchema.parse({ ...base, ts: 1.5 })).toThrow();
  });

  it('builds instrument keys', () => {
    expect(instrumentKey(base.instrument)).toBe('TGAT:ASML');
  });
});
