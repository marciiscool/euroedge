import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Tick } from '@euroedge/shared';
import { CSV_HEADER, CsvFormatError, parseTickCsv, tickToCsv } from '../csv.ts';
import { loadTickFile, ReplayProvider } from './provider.ts';

const t = (ts: number, symbol = 'ASML', last = 700.5): Tick => ({
  source: 'sim',
  instrument: { venue: 'XAMS', symbol },
  ts,
  currency: 'EUR',
  kind: 'trade',
  last,
  size: 10,
});

describe('tick CSV', () => {
  it('round-trips ticks, including symbols with spaces and empty fields', () => {
    const ticks: Tick[] = [
      t(1_800_000_000_000),
      {
        ...t(1_800_000_001_000, 'NOVO B'),
        kind: 'quote',
        bid: 300.1,
        ask: 300.3,
        last: undefined,
        size: undefined,
      } as Tick,
    ].map((x) => JSON.parse(JSON.stringify(x)) as Tick);
    const csv = [CSV_HEADER, ...ticks.map(tickToCsv)].join('\n');
    expect(parseTickCsv(csv)).toEqual(ticks);
  });

  it('rejects a bad header, bad values and unsorted rows with the line number', () => {
    expect(() => parseTickCsv('ts,x\n')).toThrow(CsvFormatError);
    expect(() =>
      parseTickCsv(`${CSV_HEADER}\n${tickToCsv(t(1000)).replace('XAMS', 'NOPE')}`),
    ).toThrow(/line 2/);
    expect(() =>
      parseTickCsv([CSV_HEADER, tickToCsv(t(2000)), tickToCsv(t(1000))].join('\n')),
    ).toThrow(/line 3: rows must be sorted/);
  });
});

describe('ReplayProvider', () => {
  it('replays on a virtual clock at the chosen speed and re-tags the source', () => {
    let wall = 0;
    const ticks = [t(10_000), t(70_000), t(130_000), t(130_000, 'OTHER')];
    const p = new ReplayProvider({ ticks, speed: 60, now: () => wall });
    const got: Tick[] = [];
    const unsub = p.subscribe([{ venue: 'XAMS', symbol: 'ASML' }], (x) => got.push(x));
    p.poll();
    expect(got.map((x) => x.ts)).toEqual([10_000]);
    wall = 1_000; // 1 s wall = 60 s virtual
    p.poll();
    expect(got.map((x) => x.ts)).toEqual([10_000, 70_000]);
    wall = 2_000;
    p.poll();
    expect(got.map((x) => x.ts)).toEqual([10_000, 70_000, 130_000]);
    expect(got.every((x) => x.source === 'replay')).toBe(true);
    expect(p.finished).toBe(true);
    unsub();
    expect(() => new ReplayProvider({ ticks, speed: 2000 })).toThrow(RangeError);
  });

  it('loads the committed two-week sample: sorted, multi-currency, holiday-aware', async () => {
    const path = fileURLToPath(
      new URL('../../../../data/sample/sim-2027-03-15_2027-03-31.csv.gz', import.meta.url),
    );
    const ticks = await loadTickFile(path);
    expect(ticks.length).toBeGreaterThan(100_000);
    const venues = new Set(ticks.map((x) => x.instrument.venue));
    for (const v of ['XAMS', 'XETR', 'XCSE', 'XLON', 'XPAR', 'TGAT', 'XNAS', 'XNYS', 'USON', 'FX'])
      expect(venues).toContain(v);
    expect(ticks.find((x) => x.instrument.venue === 'XCSE')?.currency).toBe('DKK');
    expect(ticks.find((x) => x.instrument.venue === 'XLON')?.currency).toBe('GBX');
    // Good Friday 26 Mar 2027: no trades on Amsterdam or Tradegate.
    const gf = (x: Tick) =>
      x.ts >= Date.parse('2027-03-26T00:00:00+01:00') &&
      x.ts < Date.parse('2027-03-27T00:00:00+01:00');
    expect(
      ticks.filter(
        (x) => gf(x) && (x.instrument.venue === 'XAMS' || x.instrument.venue === 'TGAT'),
      ),
    ).toEqual([]);
  }, 60_000);
});
