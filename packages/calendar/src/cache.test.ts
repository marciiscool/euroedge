import fc from 'fast-check';
import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import { CalendarCache } from './cache.ts';
import { isInClosingAuction, isVenueOpen, windowAt } from './resolver.ts';

const start = DateTime.fromISO('2026-10-01T00:00', { zone: 'Europe/Berlin' }).toMillis();
const ASML = { primary: 'XAMS', extended: 'TGAT' } as const;

describe('CalendarCache', () => {
  it('agrees with the uncached resolver, also when time jumps around (property)', () => {
    const cache = new CalendarCache();
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 120 * 24 * 60 }), (min) => {
        const ts = start + min * 60_000;
        expect(cache.windowAt(ASML, ts)).toBe(windowAt(ASML, ts));
        expect(cache.isVenueOpen('XNAS', ts)).toBe(isVenueOpen('XNAS', ts));
        expect(cache.isVenueOpen('FX', ts)).toBe(isVenueOpen('FX', ts));
        expect(cache.isInClosingAuction('XAMS', ts)).toBe(isInClosingAuction('XAMS', ts));
      }),
      { numRuns: 150 },
    );
    expect(cache.segments(ASML, start, 86_400_000).length).toBeGreaterThan(0);
  }, 30_000);
});
