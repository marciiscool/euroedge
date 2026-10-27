import type { Venue, Window } from '@euroedge/shared';
import { PHASES, type Phase } from './schema.ts';
import {
  phaseIntervals,
  windowSegments,
  type Interval,
  type VenueState,
  type WindowSegment,
  type WindowVenues,
} from './resolver.ts';

const DAY = 86_400_000;

interface Cached<T> {
  readonly from: number;
  readonly to: number;
  readonly value: T;
}

/**
 * Memoised calendar lookups for hot loops (1 Hz FV service, simulators, backtests).
 * Results equal the uncached resolver; intervals are recomputed as time moves on.
 */
export class CalendarCache {
  private readonly phases = new Map<string, Cached<Interval[]>>();
  private readonly windows = new Map<string, Cached<WindowSegment[]>>();

  private intervals(venue: Venue, phase: Phase, ts: number): Interval[] {
    const key = `${venue}/${phase}`;
    let c = this.phases.get(key);
    if (c === undefined || ts < c.from || ts >= c.to) {
      const from = ts - DAY;
      const to = ts + 8 * DAY;
      c = { from, to, value: phaseIntervals(venue, phase, from, to) };
      this.phases.set(key, c);
    }
    return c.value;
  }

  inPhase(venue: Venue, phase: Phase, ts: number): boolean {
    return this.intervals(venue, phase, ts).some((i) => ts >= i.from && ts < i.to);
  }

  isVenueOpen(venue: Venue, ts: number): boolean {
    return this.inPhase(venue, 'continuous', ts);
  }

  isInClosingAuction(venue: Venue, ts: number): boolean {
    return this.inPhase(venue, 'closingAuction', ts);
  }

  venueState(venue: Venue, ts: number): VenueState {
    for (const p of PHASES) if (this.inPhase(venue, p, ts)) return p;
    return 'closed';
  }

  /** The phase interval containing `ts`, if any (e.g. to find an auction's scheduled end). */
  currentInterval(venue: Venue, phase: Phase, ts: number): Interval | undefined {
    return this.intervals(venue, phase, ts).find((i) => ts >= i.from && ts < i.to);
  }

  windowAt(v: WindowVenues, ts: number): Window {
    const key = `${v.primary}/${v.extended}`;
    let c = this.windows.get(key);
    if (c === undefined || ts < c.from || ts >= c.to) {
      const from = ts - 3_600_000;
      const to = ts + 3 * DAY;
      c = { from, to, value: windowSegments(v, from, to) };
      this.windows.set(key, c);
    }
    const seg = c.value.find((s) => ts >= s.from && ts < s.to);
    if (seg === undefined) throw new Error('calendar cache miss');
    return seg.window;
  }

  /** Segments from `ts` up to `ts + horizonMs` (session ribbon). */
  segments(v: WindowVenues, ts: number, horizonMs: number): WindowSegment[] {
    return windowSegments(v, ts, ts + horizonMs);
  }
}
