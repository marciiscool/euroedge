import fc from 'fast-check';
import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import {
  isInClosingAuction,
  isVenueOpen,
  nextWindowChange,
  windowAt,
  windowSegments,
  type WindowVenues,
} from './resolver.ts';

const ASML: WindowVenues = { primary: 'XAMS', extended: 'TGAT' };
/** Wall-clock time in Berlin/Amsterdam (CET/CEST) → UTC ms. */
const cet = (iso: string) => DateTime.fromISO(iso, { zone: 'Europe/Berlin' }).toMillis();

describe('venue sessions', () => {
  it('XAMS continuous 09:00–17:30 local, closing auction 17:30–17:35', () => {
    expect(isVenueOpen('XAMS', cet('2026-10-27T08:59'))).toBe(false);
    expect(isVenueOpen('XAMS', cet('2026-10-27T09:00'))).toBe(true);
    expect(isVenueOpen('XAMS', cet('2026-10-27T17:29'))).toBe(true);
    expect(isVenueOpen('XAMS', cet('2026-10-27T17:30'))).toBe(false);
    expect(isInClosingAuction('XAMS', cet('2026-10-27T17:32'))).toBe(true);
    expect(isInClosingAuction('XAMS', cet('2026-10-27T17:35'))).toBe(false);
  });

  it('DST mismatch week 26–30 Oct 2026: Nasdaq opens 14:30 CET (EU on winter time, US not yet)', () => {
    expect(isVenueOpen('XNAS', cet('2026-10-27T14:29'))).toBe(false);
    expect(isVenueOpen('XNAS', cet('2026-10-27T14:30'))).toBe(true);
    expect(isVenueOpen('XNAS', cet('2026-10-27T20:59'))).toBe(true);
    expect(isVenueOpen('XNAS', cet('2026-10-27T21:00'))).toBe(false);
    // After the US switch (1 Nov 2026) the usual 15:30–22:00 CET returns.
    expect(isVenueOpen('XNAS', cet('2026-11-02T15:29'))).toBe(false);
    expect(isVenueOpen('XNAS', cet('2026-11-02T15:30'))).toBe(true);
    expect(isVenueOpen('XNAS', cet('2026-11-02T21:59'))).toBe(true);
  });

  it('DST mismatch March 2027: US switches 14 Mar, EU 28 Mar → Nasdaq 14:30 CET in between', () => {
    expect(isVenueOpen('XNAS', cet('2027-03-16T14:30'))).toBe(true);
    expect(isVenueOpen('XNAS', cet('2027-03-30T14:30'))).toBe(false);
    expect(isVenueOpen('XNAS', cet('2027-03-30T15:30'))).toBe(true);
  });

  it('FX trades Sunday 17:00 to Friday 17:00 New York', () => {
    const ny = (iso: string) => DateTime.fromISO(iso, { zone: 'America/New_York' }).toMillis();
    expect(isVenueOpen('FX', ny('2026-11-01T16:59'))).toBe(false); // Sunday
    expect(isVenueOpen('FX', ny('2026-11-01T17:00'))).toBe(true);
    expect(isVenueOpen('FX', ny('2026-11-04T03:00'))).toBe(true); // Wednesday night
    expect(isVenueOpen('FX', ny('2026-11-06T16:59'))).toBe(true); // Friday
    expect(isVenueOpen('FX', ny('2026-11-06T17:00'))).toBe(false);
    expect(isVenueOpen('FX', ny('2026-11-07T12:00'))).toBe(false); // Saturday
  });
});

describe('windows (ASML: XAMS primary, Tradegate extended)', () => {
  it.each([
    ['2026-10-27T03:00', 'C'], // Tuesday night
    ['2026-10-27T07:59', 'C'],
    ['2026-10-27T08:00', 'B'],
    ['2026-10-27T09:00', 'A'],
    ['2026-10-27T17:29', 'A'],
    ['2026-10-27T17:30', 'B'], // closing auction: no continuous trading
    ['2026-10-27T21:59', 'B'],
    ['2026-10-27T22:00', 'C'],
    ['2026-10-30T22:00', 'D'], // Friday close → weekend
    ['2026-10-31T12:00', 'D'],
    ['2026-11-02T07:59', 'D'], // Monday before Tradegate opens
    ['2026-11-02T08:00', 'B'],
  ] as const)('%s CET → %s', (t, w) => {
    expect(windowAt(ASML, cet(t))).toBe(w);
  });

  it('finds the next window change', () => {
    expect(nextWindowChange(ASML, cet('2026-10-27T12:00'))).toEqual({
      at: cet('2026-10-27T17:30'),
      window: 'B',
    });
    expect(nextWindowChange(ASML, cet('2026-10-30T22:30'))).toEqual({
      at: cet('2026-11-02T08:00'),
      window: 'B',
    });
  });

  it('builds a 24 h ribbon that partitions the interval', () => {
    const from = cet('2026-10-27T00:00');
    const to = cet('2026-10-28T00:00');
    const segs = windowSegments(ASML, from, to);
    expect(segs.map((s) => s.window)).toEqual(['C', 'B', 'A', 'B', 'C']);
    expect(segs[0]?.from).toBe(from);
    expect(segs.at(-1)?.to).toBe(to);
  });

  it('segments are contiguous, non-empty and agree with windowAt (property)', () => {
    const start = cet('2026-10-01T00:00');
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 90 * 24 * 60 }),
        fc.integer({ min: 60, max: 3 * 24 * 60 }),
        (offsetMin, lenMin) => {
          const from = start + offsetMin * 60_000;
          const to = from + lenMin * 60_000;
          const segs = windowSegments(ASML, from, to);
          expect(segs[0]?.from).toBe(from);
          expect(segs.at(-1)?.to).toBe(to);
          segs.forEach((s, i) => {
            expect(s.to).toBeGreaterThan(s.from);
            if (i > 0) {
              expect(s.from).toBe(segs[i - 1]?.to);
              expect(s.window).not.toBe(segs[i - 1]?.window);
            }
            expect(windowAt(ASML, s.from)).toBe(s.window);
            expect(windowAt(ASML, s.to - 1)).toBe(s.window);
          });
        },
      ),
      { numRuns: 100 },
    );
  });
});
