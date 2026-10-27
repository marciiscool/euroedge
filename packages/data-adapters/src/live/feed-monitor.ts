import { CalendarCache, type VenueState } from '@euroedge/calendar';
import { instrumentKey, type InstrumentRef, type Tick } from '@euroedge/shared';
import type { ProviderHealth } from '../provider.ts';

/** Calendar state plus what the feed shows: a venue that should trade but is silent is halted. */
export type FeedStatus = VenueState | 'halted' | 'provider-down';

export interface FeedMonitorOptions {
  /** Silence during continuous trading after which an instrument counts as halted (default 60 s). */
  readonly haltAfterMs?: number;
  readonly calendar?: CalendarCache;
}

/**
 * Halt detection from feed silence and provider health (M2-08). Feeds the circuit breakers
 * (CB2: Tradegate silent > 60 s while the primary is open; CB3 staleness) in M3.
 */
export class FeedMonitor {
  private readonly last = new Map<string, number>();
  private readonly haltAfterMs: number;
  private readonly calendar: CalendarCache;

  constructor(opts: FeedMonitorOptions = {}) {
    this.haltAfterMs = opts.haltAfterMs ?? 60_000;
    this.calendar = opts.calendar ?? new CalendarCache();
  }

  onTick(t: Tick): void {
    const key = instrumentKey(t.instrument);
    if ((this.last.get(key) ?? -Infinity) < t.ts) this.last.set(key, t.ts);
  }

  lastTickTs(i: InstrumentRef): number | undefined {
    return this.last.get(instrumentKey(i));
  }

  status(i: InstrumentRef, now: number, provider?: ProviderHealth): FeedStatus {
    const state = this.calendar.venueState(i.venue, now);
    if (state !== 'continuous') return state;
    if (provider !== undefined && !provider.connected) return 'provider-down';
    const last = this.last.get(instrumentKey(i));
    // Measure silence from the later of the last tick and the session open.
    const open = this.calendar.currentInterval(i.venue, 'continuous', now)?.from ?? now;
    const since = Math.max(last ?? -Infinity, open);
    return now - since > this.haltAfterMs ? 'halted' : 'continuous';
  }
}
