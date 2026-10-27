import { DateTime } from 'luxon';
import type { Venue, Window } from '@euroedge/shared';
import { PHASES, type Phase } from './schema.ts';
import { calendarFor, phasesOpeningOn, spanOf } from './sessions.ts';

export interface Interval {
  /** UTC ms, inclusive. */
  readonly from: number;
  /** UTC ms, exclusive. */
  readonly to: number;
}

/** Calendar state of a venue. Halts are layered on top from feed health (M2-08). */
export type VenueState = Phase | 'closed';

/**
 * Concrete UTC intervals of one phase overlapping [fromMs, toMs), honouring holidays and
 * special sessions. DST-correct: wall-clock times are resolved per day via Luxon.
 */
export function phaseIntervals(
  venue: Venue,
  phase: Phase,
  fromMs: number,
  toMs: number,
): Interval[] {
  const cal = calendarFor(venue);
  const out: Interval[] = [];
  // Step through local calendar dates as plain UTC dates (cheap); wall-clock times are
  // resolved in the venue's zone once per date and memoised.
  let day = DateTime.fromMillis(fromMs, { zone: cal.tz })
    .setZone('utc', { keepLocalTime: true })
    .startOf('day')
    .minus({ days: cal.maxSpanDays + 1 });
  const end = DateTime.fromMillis(toMs, { zone: cal.tz }).setZone('utc', { keepLocalTime: true });
  while (day <= end) {
    const iv = dayIntervals(venue, day)[phase];
    if (iv !== undefined && iv.to > fromMs && iv.from < toMs) out.push(iv);
    day = day.plus({ days: 1 });
  }
  return out;
}

type DayIntervals = Partial<Record<Phase, Interval>>;
const dayCache = new Map<string, DayIntervals>();
const DAY_CACHE_MAX = 50_000;

/** All phase intervals of sessions opening on one local date (`localDate` is that date in UTC). */
function dayIntervals(venue: Venue, localDate: DateTime): DayIntervals {
  const key = `${venue}|${localDate.toMillis()}`;
  const hit = dayCache.get(key);
  if (hit !== undefined) return hit;
  const cal = calendarFor(venue);
  const date = localDate.setZone(cal.tz, { keepLocalTime: true });
  const phases = phasesOpeningOn(cal, date);
  const out: DayIntervals = {};
  if (phases !== undefined)
    for (const p of PHASES) {
      const rule = phases[p];
      if (rule === undefined) continue;
      const [oh, om] = rule.open.split(':').map(Number) as [number, number];
      const [ch, cm] = rule.close.split(':').map(Number) as [number, number];
      const open = date.set({ hour: oh, minute: om });
      const close = date
        .plus({ days: spanOf(rule.open, rule.close, rule.spanDays) })
        .set({ hour: ch, minute: cm });
      out[p] = { from: open.toMillis(), to: close.toMillis() };
    }
  if (dayCache.size >= DAY_CACHE_MAX) dayCache.clear();
  dayCache.set(key, out);
  return out;
}

const within = (ivs: readonly Interval[], ts: number) => ivs.some((i) => ts >= i.from && ts < i.to);

export const isVenueOpen = (venue: Venue, ts: number): boolean =>
  within(phaseIntervals(venue, 'continuous', ts, ts + 1), ts);

export const isInClosingAuction = (venue: Venue, ts: number): boolean =>
  within(phaseIntervals(venue, 'closingAuction', ts, ts + 1), ts);

export function venueState(venue: Venue, ts: number): VenueState {
  for (const p of PHASES) if (within(phaseIntervals(venue, p, ts, ts + 1), ts)) return p;
  return 'closed';
}

export interface VenueTransition {
  readonly at: number;
  readonly state: VenueState;
}

/** The next instant after `ts` at which the venue's state changes (searches 10 days ahead). */
export function nextVenueTransition(venue: Venue, ts: number): VenueTransition | undefined {
  const current = venueState(venue, ts);
  const horizon = ts + 10 * 86_400_000;
  const cuts = new Set<number>();
  for (const p of PHASES)
    for (const iv of phaseIntervals(venue, p, ts, horizon)) {
      cuts.add(iv.from);
      cuts.add(iv.to);
    }
  for (const at of [...cuts].filter((t) => t > ts && t < horizon).sort((a, b) => a - b)) {
    const state = venueState(venue, at);
    if (state !== current) return { at, state };
  }
  return undefined;
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
 * D = weekends and holidays (a gap between extended sessions longer than a weeknight);
 * C = all other (weeknight) time.
 */
export function windowAt(v: WindowVenues, ts: number): Window {
  if (isVenueOpen(v.primary, ts)) return 'A';
  if (isVenueOpen(v.extended, ts)) return 'B';
  const lookaround = 6 * 86_400_000;
  const sessions = phaseIntervals(v.extended, 'continuous', ts - lookaround, ts + lookaround);
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

/** Instants where any defining venue opens or closes continuous trading, within (fromMs, toMs). */
function boundaries(v: WindowVenues, fromMs: number, toMs: number): number[] {
  const set = new Set<number>();
  for (const venue of [v.primary, v.extended])
    for (const iv of phaseIntervals(venue, 'continuous', fromMs, toMs)) {
      set.add(iv.from);
      set.add(iv.to);
    }
  return [...set].filter((t) => t > fromMs && t < toMs).sort((a, b) => a - b);
}

/** The next instant after `ts` at which the window changes (searches up to 10 days ahead). */
export function nextWindowChange(v: WindowVenues, ts: number): WindowChange | undefined {
  const current = windowAt(v, ts);
  for (const b of boundaries(v, ts, ts + 10 * 86_400_000)) {
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
