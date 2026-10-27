import { readFile } from 'node:fs/promises';
import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import type { Venue } from '@euroedge/shared';
import { parseConfig } from '@euroedge/shared/config';
import fixture from './fixtures/exchange-calendars-2026-2028.json' with { type: 'json' };
import { buildCalendarsModule, GENERATED_PATH, loadCalendarFiles } from '../src/build.ts';
import {
  calendarFileSchema,
  calendarFor,
  calendarVenues,
  coverageDaysLeft,
  isVenueOpen,
  nextVenueTransition,
  venueState,
  windowAt,
} from '../src/index.ts';

const at = (venue: Venue, iso: string) =>
  DateTime.fromISO(iso, { zone: calendarFor(venue).tz }).toMillis();
const cet = (iso: string) => DateTime.fromISO(iso, { zone: 'Europe/Berlin' }).toMillis();

describe('curated calendars (ADR-0004)', () => {
  it('the generated module is in sync with config/calendars', async () => {
    expect(await readFile(GENERATED_PATH, 'utf8')).toBe(await buildCalendarsModule());
  });

  it('covers every venue', async () => {
    expect(calendarVenues().sort()).toEqual((await loadCalendarFiles()).map((c) => c.venue).sort());
    expect(calendarVenues()).toHaveLength(13);
  });

  it('CI fails 120 days before any calendar runs out of data', () => {
    const left = coverageDaysLeft(Date.now());
    expect(left.days, `${left.venue} calendar runs out in ${left.days} days`).toBeGreaterThan(120);
  });

  describe.each(Object.entries(fixture.calendars))(
    'cross-check %s vs exchange_calendars',
    (mic, x) => {
      const venues: Venue[] = mic === 'XNYS' ? ['XNYS', 'XNAS'] : [mic as Venue];
      it.each(venues)('%s: same weekday closures, early closes and regular hours', (venue) => {
        const cal = calendarFor(venue);
        expect(cal.tz).toBe(x.tz);
        expect([...cal.holidays.keys()]).toEqual(x.weekdayClosures);
        const special = Object.fromEntries(cal.file.specialSessions.map((s) => [s.date, s.phases]));
        expect(Object.keys(special)).toEqual(Object.keys(x.earlyCloses));
        for (const [date, close] of Object.entries(x.earlyCloses)) {
          const p = special[date];
          // exchange_calendars quotes either the continuous close or the closing-auction end.
          expect([p?.continuous.close, p?.closingAuction?.close]).toContain(close);
        }
        expect(cal.file.regular.phases.continuous.open).toBe(x.regularOpen);
        const { continuous, closingAuction } = cal.file.regular.phases;
        expect([continuous.close, closingAuction?.close]).toContain(x.regularClose);
      });
    },
  );
});

describe('holidays, half-days and phases', () => {
  it('Good Friday: Amsterdam and Tradegate closed → Window D all day', () => {
    expect(isVenueOpen('XAMS', cet('2026-04-03T12:00'))).toBe(false);
    expect(windowAt({ primary: 'XAMS', extended: 'TGAT' }, cet('2026-04-03T12:00'))).toBe('D');
    expect(windowAt({ primary: 'XAMS', extended: 'TGAT' }, cet('2026-04-07T09:00'))).toBe('A');
  });

  it('Ascension Day: Copenhagen closed while Tradegate trades → Window B', () => {
    const novo = { primary: 'XCSE', extended: 'TGAT' } as const;
    expect(windowAt(novo, cet('2026-05-14T12:00'))).toBe('B');
    expect(windowAt(novo, cet('2026-05-15T12:00'))).toBe('B');
    expect(windowAt(novo, cet('2026-05-18T12:00'))).toBe('A');
  });

  it('Euronext half-day on 24 Dec: A until 14:00 then D (Tradegate closed)', () => {
    const asml = { primary: 'XAMS', extended: 'TGAT' } as const;
    expect(windowAt(asml, cet('2026-12-24T08:30'))).toBe('D');
    expect(windowAt(asml, cet('2026-12-24T13:59'))).toBe('A');
    expect(venueState('XAMS', cet('2026-12-24T14:02'))).toBe('closingAuction');
    expect(windowAt(asml, cet('2026-12-24T14:00'))).toBe('D');
  });

  it('Xetra closes at 14:00 on the last trading day of the year', () => {
    expect(isVenueOpen('XETR', cet('2026-12-30T13:59'))).toBe(true);
    expect(isVenueOpen('XETR', cet('2026-12-30T14:00'))).toBe(false);
    expect(isVenueOpen('XETR', cet('2026-12-31T10:00'))).toBe(false);
  });

  it('US early close after Thanksgiving at 13:00 New York (19:00 CET)', () => {
    expect(isVenueOpen('XNAS', at('XNAS', '2026-11-26T11:00'))).toBe(false);
    expect(isVenueOpen('XNAS', at('XNAS', '2026-11-27T12:59'))).toBe(true);
    expect(isVenueOpen('XNAS', cet('2026-11-27T19:00'))).toBe(false);
    expect(venueState('XNAS', cet('2026-11-27T19:00'))).toBe('postTrading');
  });

  it('US overnight session belongs to the next trade date', () => {
    expect(isVenueOpen('USON', at('USON', '2026-01-11T20:00'))).toBe(true); // Sunday evening
    expect(isVenueOpen('USON', at('USON', '2026-01-12T03:59'))).toBe(true);
    expect(isVenueOpen('USON', at('USON', '2026-01-12T04:00'))).toBe(false);
    // Sunday 18 Jan 2026: Monday is MLK day, so no overnight session.
    expect(isVenueOpen('USON', at('USON', '2026-01-18T21:00'))).toBe(false);
    expect(isVenueOpen('USON', at('USON', '2026-01-16T21:00'))).toBe(false); // Friday
  });

  it('London substitutes Boxing Day 2026 to Monday 28 Dec', () => {
    expect(isVenueOpen('XLON', at('XLON', '2026-12-28T10:00'))).toBe(false);
    expect(isVenueOpen('XLON', at('XLON', '2026-12-29T10:00'))).toBe(true);
  });

  it('resolves Xetra phases and the next transition', () => {
    expect(venueState('XETR', cet('2026-10-27T07:00'))).toBe('closed');
    expect(venueState('XETR', cet('2026-10-27T08:00'))).toBe('preOpen');
    expect(venueState('XETR', cet('2026-10-27T08:55'))).toBe('openingAuction');
    expect(nextVenueTransition('XETR', cet('2026-10-27T08:55'))).toEqual({
      at: cet('2026-10-27T09:00'),
      state: 'continuous',
    });
    expect(nextVenueTransition('XETR', cet('2026-10-30T21:00'))).toEqual({
      at: cet('2026-11-02T07:30'),
      state: 'preOpen',
    });
    expect(nextVenueTransition('XETR', cet('2026-04-02T21:00'))?.at).toBe(cet('2026-04-07T07:30'));
  });
});

describe('calendar schema', () => {
  const base = {
    venue: 'XETR',
    name: 'x',
    tz: 'Europe/Berlin',
    coverage: { from: '2026-01-01', to: '2026-12-31' },
    sources: [{ years: [2026], url: 'https://example.com', retrieved: null, verified: false }],
    regular: { days: [1, 2, 3, 4, 5], phases: { continuous: { open: '09:00', close: '17:30' } } },
    holidays: [],
  };
  const parse = (over: object) => () => parseConfig('t', { ...base, ...over }, calendarFileSchema);

  it('accepts a minimal calendar', () => {
    expect(parse({})()).toMatchObject({ tradeDateOffsetDays: 0, specialSessions: [] });
  });
  it.each([
    ['a holiday on a weekend', { holidays: [{ date: '2026-01-03', name: 'Sat' }] }],
    [
      'unsorted holidays',
      {
        holidays: [
          { date: '2026-05-01', name: 'b' },
          { date: '2026-01-01', name: 'a' },
        ],
      },
    ],
    ['a holiday outside coverage', { holidays: [{ date: '2027-01-01', name: 'a' }] }],
    ['a year without a source', { coverage: { from: '2026-01-01', to: '2027-12-31' } }],
    ['an unknown time zone', { tz: 'Europe/Atlantis' }],
    [
      'a malformed time',
      { regular: { days: [1], phases: { continuous: { open: '9:00', close: '17:30' } } } },
    ],
  ])('rejects %s', (_, over) => {
    expect(parse(over)).toThrow();
  });
});
