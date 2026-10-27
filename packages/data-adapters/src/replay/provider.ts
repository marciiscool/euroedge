import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { instrumentKey, type InstrumentRef, type Tick } from '@euroedge/shared';
import { parseTickCsv } from '../csv.ts';
import type { MarketDataProvider, ProviderHealth, Unsubscribe } from '../provider.ts';

export interface ReplayProviderOptions {
  readonly ticks: readonly Tick[];
  /** Replay speed, 1× to 1000× (brief §4.2). */
  readonly speed?: number;
  /** Virtual start; default the first tick. */
  readonly startTs?: number;
  /** Wall clock (injected for tests). */
  readonly now?: () => number;
  readonly pollMs?: number;
}

/** Loads a tick CSV, gzip-compressed if the name ends in .gz. */
export async function loadTickFile(path: string): Promise<Tick[]> {
  const buf = await readFile(path);
  return parseTickCsv((path.endsWith('.gz') ? gunzipSync(buf) : buf).toString('utf8'));
}

/**
 * Replays recorded ticks on a virtual clock: virtual = start + (wall − wallStart) × speed.
 * Ticks keep their recorded timestamps (re-tagged `source: replay`) so calendars and
 * windows behave exactly as when they were recorded.
 */
export class ReplayProvider implements MarketDataProvider {
  readonly id = 'replay' as const;
  private readonly ticks: readonly Tick[];
  private readonly speed: number;
  private readonly now: () => number;
  private readonly pollMs: number;
  private readonly wallStart: number;
  private readonly virtualStart: number;
  private cursor = 0;
  private readonly subs = new Set<{ keys: Set<string>; onTick: (t: Tick) => void }>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private lastWall: number | undefined;

  constructor(opts: ReplayProviderOptions) {
    const speed = opts.speed ?? 1;
    if (!(speed >= 1 && speed <= 1000)) throw new RangeError('speed must be within 1–1000');
    this.ticks = opts.ticks;
    this.speed = speed;
    this.now = opts.now ?? Date.now;
    this.pollMs = opts.pollMs ?? 250;
    this.wallStart = this.now();
    this.virtualStart = opts.startTs ?? opts.ticks[0]?.ts ?? 0;
    while ((this.ticks[this.cursor]?.ts ?? Infinity) < this.virtualStart) this.cursor++;
  }

  /** Current virtual time. */
  virtualNow(): number {
    return this.virtualStart + (this.now() - this.wallStart) * this.speed;
  }

  get finished(): boolean {
    return this.cursor >= this.ticks.length;
  }

  subscribe(instruments: readonly InstrumentRef[], onTick: (t: Tick) => void): Unsubscribe {
    const sub = { keys: new Set(instruments.map(instrumentKey)), onTick };
    this.subs.add(sub);
    this.timer ??= setInterval(() => this.poll(), this.pollMs);
    return () => {
      this.subs.delete(sub);
      if (this.subs.size === 0 && this.timer !== undefined) {
        clearInterval(this.timer);
        this.timer = undefined;
      }
    };
  }

  /** Delivers every tick up to the virtual now. Public for deterministic tests. */
  poll(): void {
    const until = this.virtualNow();
    while (this.cursor < this.ticks.length) {
      const t = this.ticks[this.cursor];
      if (t === undefined || t.ts > until) break;
      this.cursor++;
      const tick: Tick = { ...t, source: 'replay' };
      this.lastWall = this.now();
      const key = instrumentKey(tick.instrument);
      for (const s of this.subs) if (s.keys.has(key)) s.onTick(tick);
    }
  }

  health(): ProviderHealth {
    return {
      connected: this.timer !== undefined && !this.finished,
      lastTickAgeMs: this.lastWall === undefined ? undefined : this.now() - this.lastWall,
      errorRate: 0,
    };
  }
}
