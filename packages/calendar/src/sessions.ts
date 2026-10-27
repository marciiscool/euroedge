import type { Venue } from '@euroedge/shared';

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface SessionRule {
  /** Local wall-clock time "HH:mm" in the venue's time zone. */
  readonly open: string;
  readonly close: string;
  /** Weekdays (local) on which the session opens. A close earlier than open ends next day. */
  readonly days: readonly Weekday[];
}

export interface VenueSchedule {
  readonly venue: Venue;
  readonly tz: string;
  /** Continuous trading (Window A for a primary venue; liveness for others). */
  readonly continuous: SessionRule;
  /** Closing auction after continuous trading, if any (official close print at its end). */
  readonly closingAuction?: SessionRule;
}

const WEEKDAYS: readonly Weekday[] = [1, 2, 3, 4, 5];

/**
 * INTERIM hard-coded schedules for M1 (no holidays, half-days or random auction ends).
 * Replaced by curated YAML calendars 2026–2028 in M2 (ADR-0004); the API stays the same.
 */
export const INTERIM_SCHEDULES: Readonly<Partial<Record<Venue, VenueSchedule>>> = {
  XAMS: {
    venue: 'XAMS',
    tz: 'Europe/Amsterdam',
    continuous: { open: '09:00', close: '17:30', days: WEEKDAYS },
    closingAuction: { open: '17:30', close: '17:35', days: WEEKDAYS },
  },
  XETR: {
    venue: 'XETR',
    tz: 'Europe/Berlin',
    continuous: { open: '09:00', close: '17:30', days: WEEKDAYS },
    closingAuction: { open: '17:30', close: '17:35', days: WEEKDAYS },
  },
  TGAT: {
    venue: 'TGAT',
    tz: 'Europe/Berlin',
    continuous: { open: '08:00', close: '22:00', days: WEEKDAYS },
  },
  XNAS: {
    venue: 'XNAS',
    tz: 'America/New_York',
    continuous: { open: '09:30', close: '16:00', days: WEEKDAYS },
  },
  XNYS: {
    venue: 'XNYS',
    tz: 'America/New_York',
    continuous: { open: '09:30', close: '16:00', days: WEEKDAYS },
  },
  // FX trades 24/5: Sunday 17:00 New York until Friday 17:00 New York.
  FX: {
    venue: 'FX',
    tz: 'America/New_York',
    continuous: { open: '17:00', close: '17:00', days: [7] },
  },
};

export function scheduleFor(venue: Venue): VenueSchedule {
  const s = INTERIM_SCHEDULES[venue];
  if (s === undefined) throw new Error(`no calendar for venue ${venue}`);
  return s;
}
