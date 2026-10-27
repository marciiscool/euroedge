import { DateTime } from 'luxon';
import type { Venue, Window } from '@euroedge/shared';
import { scheduleFor, type SessionRule, type Weekday } from './sessions.ts';

export interface Interval {
  /** UTC ms, inclusive. */
  readonly from: number;
  /** UTC ms, exclusive. */
  readonly to: number;
}

/** Concrete UTC intervals of a session rule overlapping [fromMs, toMs). DST-correct via Luxon. */
export function sessionIntervals(
  rule: SessionRule,
  tz: string,
  fromMs: number,
  toMs: number,
): Interval[] {
  const out: Interval[] = [];
  // Start early enough to catch sessions that began before fromMs: a week for
  // week-long sessions (FX), two days for overnight ones.
  const weekLong = rule.open === rule.close;
  let day = DateTime.fromMillis(fromMs, { zone: tz })
    .startOf('day')
    .minus({ days: weekLong ? 7 : 2 });
  const end = DateTime.fromMillis(toMs, { zone: tz }).endOf('day');
  const [oh, om] = rule.open.split(':').map(Number) as [number, number];
  const [ch, cm] = rule.close.split(':').map(Number) as [number, number];
  while (day <= end) {
    if (rule.days.includes(day.weekday as Weekday)) {
      const open = day.set({ hour: oh, minute: om });
      let close = day.set({ hour: ch, minute: cm });
      if (close <= open) close = close.plus({ days: 1 });
      // open === close means a week-long session (FX 24/5: Sunday open → Friday close).
      if (weekLong) close = open.plus({ days: 5 });
      const iv = { from: open.toMillis(), to: close.toMillis() };
      if (iv.to > fromMs && iv.from < toMs) out.push(iv);
    }
    day = day.plus({ days: 1 });
  }
  return out;
}

const within = (ivs: readonly Interval[], ts: number) => ivs.some((i) => ts >= i.from && ts < i.to);

export function isVenueOpen(venue: Venue, ts: number): boolean {
  const s = scheduleFor(venue);
  return within(sessionIntervals(s.continuous, s.tz, ts, ts + 1), ts);
}

export function isInClosingAuction(venue: Venue, ts: number): boolean {
  const s = scheduleFor(venue);
  return (
    s.closingAuction !== undefined &&
    within(sessionIntervals(s.closingAuction, s.tz, ts, ts + 1), ts)
  );
}

/** The venues that define a market's windows (brief §6.2, ADR-0017). */
export interface WindowVenues {
  /** Window A: continuous trading on the primary listing. */
  readonly primary: Venue;
  /** Window B: extended trading (Tradegate) outside Window A. */
  readonly extended: Venue;
}

/**
 * Window at `ts`: A = primary continuous; B = extended venue open outside A;
 * D = from the last extended close of the trading week until the next week's first open;
 * C = all other (weeknight) time. Holidays arrive with the M2 calendars.
 */
export function windowAt(v: WindowVenues, ts: number): Window {
  if (isVenueOpen(v.primary, ts)) return 'A';
  if (isVenueOpen(v.extended, ts)) return 'B';
  const ext = scheduleFor(v.extended);
  const lookaround = 4 * 86_400_000;
  const sessions = sessionIntervals(ext.continuous, ext.tz, ts - lookaround, ts + lookaround);
  const prev = sessions.filter((s) => s.to <= ts).at(-1);
  const next = sessions.find((s) => s.from > ts);
  if (prev === undefined || next === undefined) return 'D';
  // A gap between two extended sessions longer than a weeknight (≈ 10 h) is a weekend/holiday.
  return next.from - prev.to > 16 * 3_600_000 ? 'D' : 'C';
}

export interface WindowChange {
  readonly at: number;
  readonly window: Window;
}

/** Instants where any defining venue opens or closes, within [fromMs, toMs). */
function boundaries(v: WindowVenues, fromMs: number, toMs: number): number[] {
  const set = new Set<number>();
  for (const venue of [v.primary, v.extended]) {
    const s = scheduleFor(venue);
    for (const iv of sessionIntervals(s.continuous, s.tz, fromMs, toMs)) {
      set.add(iv.from);
      set.add(iv.to);
    }
  }
  return [...set].filter((t) => t > fromMs && t < toMs).sort((a, b) => a - b);
}

/** The next instant after `ts` at which the window changes (searches up to 7 days ahead). */
export function nextWindowChange(v: WindowVenues, ts: number): WindowChange | undefined {
  const current = windowAt(v, ts);
  for (const b of boundaries(v, ts, ts + 7 * 86_400_000)) {
    const w = windowAt(v, b);
    if (w !== current) return { at: b, window: w };
  }
  return undefined;
}

export interface WindowSegment extends Interval {
  readonly window: Window;
}

/** Contiguous window segments covering [fromMs, toMs) — the 24 h session ribbon (brief §11.2). */
export function windowSegments(v: WindowVenues, fromMs: number, toMs: number): WindowSegment[] {
  const cuts = [fromMs, ...boundaries(v, fromMs, toMs), toMs];
  const segs: WindowSegment[] = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const from = cuts[i] as number;
    const to = cuts[i + 1] as number;
    const window = windowAt(v, from);
    const last = segs.at(-1);
    if (last !== undefined && last.window === window) segs[segs.length - 1] = { ...last, to };
    else segs.push({ from, to, window });
  }
  return segs;
}
