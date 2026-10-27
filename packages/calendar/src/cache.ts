import type { Venue, Window } from '@euroedge/shared';
import { scheduleFor } from './sessions.ts';
import {
  sessionIntervals,
  windowSegments,
  type Interval,
  type WindowSegment,
  type WindowVenues,
} from './resolver.ts';

const DAY = 86_400_000;

/**
 * Memoised calendar lookups for hot loops (1 Hz FV service, simulators, backtests).
 * Results equal the uncached resolver; intervals are recomputed as time moves on.
 */
export class CalendarCache {
  private readonly venues = new Map<Venue, { from: number; to: number; ivs: Interval[] }>();
  private readonly auctions = new Map<Venue, { from: number; to: number; ivs: Interval[] }>();
  private readonly windows = new Map<string, { from: number; to: number; segs: WindowSegment[] }>();

  isVenueOpen(venue: Venue, ts: number): boolean {
    let c = this.venues.get(venue);
    if (c === undefined || ts < c.from || ts >= c.to) {
      const s = scheduleFor(venue);
      const from = ts - DAY;
      const to = ts + 8 * DAY;
      c = { from, to, ivs: sessionIntervals(s.continuous, s.tz, from, to) };
      this.venues.set(venue, c);
    }
    return c.ivs.some((i) => ts >= i.from && ts < i.to);
  }

  isInClosingAuction(venue: Venue, ts: number): boolean {
    let c = this.auctions.get(venue);
    if (c === undefined || ts < c.from || ts >= c.to) {
      const s = scheduleFor(venue);
      const from = ts - DAY;
      const to = ts + 8 * DAY;
      c = {
        from,
        to,
        ivs:
          s.closingAuction === undefined ? [] : sessionIntervals(s.closingAuction, s.tz, from, to),
      };
      this.auctions.set(venue, c);
    }
    return c.ivs.some((i) => ts >= i.from && ts < i.to);
  }

  windowAt(v: WindowVenues, ts: number): Window {
    const key = `${v.primary}/${v.extended}`;
    let c = this.windows.get(key);
    if (c === undefined || ts < c.from || ts >= c.to) {
      const from = ts - 3_600_000;
      const to = ts + 3 * DAY;
      c = { from, to, segs: windowSegments(v, from, to) };
      this.windows.set(key, c);
    }
    const seg = c.segs.find((s) => ts >= s.from && ts < s.to);
    if (seg === undefined) throw new Error('calendar cache miss');
    return seg.window;
  }

  /** Segments from `ts` up to `ts + horizonMs` (session ribbon). */
  segments(v: WindowVenues, ts: number, horizonMs: number): WindowSegment[] {
    return windowSegments(v, ts, ts + horizonMs);
  }
}
