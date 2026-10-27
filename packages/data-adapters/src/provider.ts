import type { InstrumentRef, SourceId, Tick } from '@euroedge/shared';

export type Unsubscribe = () => void;

export interface ProviderHealth {
  readonly connected: boolean;
  /** Age of the newest tick, ms; undefined before the first tick. */
  readonly lastTickAgeMs: number | undefined;
  readonly errorRate: number;
}

/** Brief §4. Implementations: sim, replay (M2), pyth (key-gated, M2), stubs. */
export interface MarketDataProvider {
  readonly id: SourceId;
  subscribe(instruments: readonly InstrumentRef[], onTick: (t: Tick) => void): Unsubscribe;
  health(): ProviderHealth;
}
