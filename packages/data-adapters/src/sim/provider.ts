import { instrumentKey, type InstrumentRef, type MarketConfig, type Tick } from '@euroedge/shared';
import type { MarketDataProvider, ProviderHealth, Unsubscribe } from '../provider.ts';
import { SimWorld } from './world.ts';

export interface SimulatedProviderOptions {
  readonly seed: number;
  readonly markets: readonly MarketConfig[];
  /** Wall clock (injected for tests). */
  readonly now?: () => number;
  readonly pollMs?: number;
}

/** Real-time wrapper around SimWorld: advances to the wall clock and fans ticks out. */
export class SimulatedProvider implements MarketDataProvider {
  readonly id = 'sim' as const;
  private readonly world: SimWorld;
  private readonly now: () => number;
  private readonly subs = new Set<{ keys: Set<string>; onTick: (t: Tick) => void }>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private lastTickTs: number | undefined;
  private readonly pollMs: number;

  constructor(opts: SimulatedProviderOptions) {
    this.now = opts.now ?? Date.now;
    this.pollMs = opts.pollMs ?? 250;
    const start = Math.floor(this.now() / 1000) * 1000;
    this.world = new SimWorld({ seed: opts.seed, startTs: start, markets: opts.markets });
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

  /** Advances the world to now and delivers ticks. Public for deterministic tests. */
  poll(): void {
    for (const t of this.world.advanceTo(this.now())) {
      this.lastTickTs = t.ts;
      const key = instrumentKey(t.instrument);
      for (const s of this.subs) if (s.keys.has(key)) s.onTick(t);
    }
  }

  health(): ProviderHealth {
    return {
      connected: this.timer !== undefined,
      lastTickAgeMs: this.lastTickTs === undefined ? undefined : this.now() - this.lastTickTs,
      errorRate: 0,
    };
  }
}
