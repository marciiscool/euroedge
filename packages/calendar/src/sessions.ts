import { DateTime } from 'luxon';
import type { Venue } from '@euroedge/shared';
import { CALENDAR_FILES } from './generated/calendars.ts';
import type { CalendarFile, Phases } from './schema.ts';

/** A venue calendar compiled for lookups (ADR-0004). */
export interface VenueCalendar {
  readonly venue: Venue;
  readonly tz: string;
  readonly file: CalendarFile;
  /** Trade date → holiday name. */
  readonly holidays: ReadonlyMap<string, string>;
  /** Trade date → special timetable (half-day, early close). */
  readonly special: ReadonlyMap<string, { readonly name: string; readonly phases: Phases }>;
  /** Longest phase span in days, to know how far back a session can start. */
  readonly maxSpanDays: number;
}

const spanOf = (open: string, close: string, spanDays: number | undefined): number =>
  spanDays ?? (close > open ? 0 : 1);

function compile(file: CalendarFile): VenueCalendar {
  const allPhases = [file.regular.phases, ...file.specialSessions.map((s) => s.phases)];
  const maxSpanDays = Math.max(
    ...allPhases.flatMap((p) =>
      Object.values(p).flatMap((r) =>
        r === undefined ? [] : [spanOf(r.open, r.close, r.spanDays)],
      ),
    ),
  );
  return {
    venue: file.venue,
    tz: file.tz,
    file,
    holidays: new Map(file.holidays.map((h) => [h.date, h.name])),
    special: new Map(file.specialSessions.map((s) => [s.date, s])),
    maxSpanDays: maxSpanDays + file.tradeDateOffsetDays,
  };
}

const CALENDARS = new Map<Venue, VenueCalendar>(CALENDAR_FILES.map((f) => [f.venue, compile(f)]));

export function calendarFor(venue: Venue): VenueCalendar {
  const c = CALENDARS.get(venue);
  if (c === undefined) throw new Error(`no calendar for venue ${venue}`);
  return c;
}

export const calendarVenues = (): Venue[] => [...CALENDARS.keys()];

/**
 * Timetable whose sessions open on local date `openDate` (ISO), or undefined if closed.
 * Holidays and special sessions are keyed by trade date (open date + tradeDateOffsetDays).
 * Dates past `coverage.to` fall back to the regular week; CI fails 120 days before that.
 */
export function phasesOpeningOn(cal: VenueCalendar, openDate: DateTime): Phases | undefined {
  const tradeDate = openDate.plus({ days: cal.file.tradeDateOffsetDays }).toISODate();
  if (tradeDate === null) return undefined;
  if (cal.holidays.has(tradeDate)) return undefined;
  const special = cal.special.get(tradeDate);
  if (special !== undefined) return special.phases;
  return cal.file.regular.days.includes(openDate.weekday) ? cal.file.regular.phases : undefined;
}

/** Holiday name for a trade date, if the venue is closed for one. */
export const holidayOn = (venue: Venue, tradeDate: string): string | undefined =>
  calendarFor(venue).holidays.get(tradeDate);

/** Days of coverage left after `nowMs` for the calendar that runs out first. */
export function coverageDaysLeft(nowMs: number): { venue: Venue; days: number } {
  let worst = { venue: 'FX' as Venue, days: Infinity };
  for (const c of CALENDARS.values()) {
    const end = DateTime.fromISO(c.file.coverage.to, { zone: c.tz }).endOf('day').toMillis();
    const days = Math.floor((end - nowMs) / 86_400_000);
    if (days < worst.days) worst = { venue: c.venue, days };
  }
  return worst;
}

export { spanOf };
