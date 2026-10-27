import type { InstrumentRef, SourceId, Tick } from '@euroedge/shared';
import type { MarketDataProvider, ProviderHealth, Unsubscribe } from '../provider.ts';
import { ProviderNotConfiguredError } from './meta.ts';

/** A provider whose vendor integration does not exist yet; it refuses to start. */
abstract class StubProvider implements MarketDataProvider {
  abstract readonly id: SourceId;
  protected abstract readonly todo: string;
  subscribe(_instruments: readonly InstrumentRef[], _onTick: (t: Tick) => void): Unsubscribe {
    throw new ProviderNotConfiguredError(this.id, this.todo);
  }
  health(): ProviderHealth {
    return { connected: false, lastTickAgeMs: undefined, errorRate: 0 };
  }
}

/**
 * Tradegate real-time quotes (live-min Window B source and Window A index input).
 * TODO(vendor): Deutsche Börse MDS or a vendor feed; map instruments by ISIN; exchange fees
 * currently 0. Founder decision pending (PLAN §8).
 */
export class TradegateProvider extends StubProvider {
  readonly id = 'tradegate' as const;
  protected readonly todo = 'no Tradegate vendor contracted yet (PLAN §8)';
}

/**
 * Xetra 15-minute delayed data: official auctions and closing prices for the anchor.
 * TODO(licence): Deutsche Börse delayed-data licence position (PLAN §8).
 */
export class XetraDelayedProvider extends StubProvider {
  readonly id = 'xetra-delayed' as const;
  protected readonly todo = 'Deutsche Börse delayed-data licence pending (PLAN §8)';
}

/** Eurex index futures (FDAX/FESX, micros FDXS/FSXE) for the futures signal, later. TODO(M3+). */
export class EurexProvider extends StubProvider {
  readonly id = 'eurex' as const;
  protected readonly todo = 'futures signal is planned after M3';
}
