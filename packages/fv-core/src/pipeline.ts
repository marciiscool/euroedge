import { CalendarCache } from '@euroedge/calendar';
import type { FvParams, MarketConfig, Tick } from '@euroedge/shared';
import { toEngineUpdate, type QuantizedUpdate } from './engine-update.ts';
import { FvModel, type FvSnapshot } from './model.ts';

export interface PipelineOutput {
  readonly snapshot: FvSnapshot;
  readonly update: QuantizedUpdate;
}

/**
 * Per-market pipeline shared by fv-service and offline runs (replay tests, backtests):
 * ticks → FvModel → calendar window → quantized engine update with the ADR-0009 mark step.
 * Deterministic for a given tick sequence and evaluation times.
 */
export class MarketFvPipeline {
  readonly market: MarketConfig;
  private readonly model: FvModel;
  private readonly calendar: CalendarCache;
  private readonly tickSize: number;
  private readonly stepCap: number;
  private prev: { mark: bigint; ts: number } | undefined;

  constructor(
    market: MarketConfig,
    params: FvParams,
    stepCapBpsPerSecond: number,
    calendar = new CalendarCache(),
  ) {
    this.market = market;
    this.calendar = calendar;
    this.tickSize = Number(market.tickSize);
    this.stepCap = stepCapBpsPerSecond;
    if (market.kind !== 'stock' || market.primarySymbol === undefined)
      throw new Error(`${market.id}: basket FV arrives in M3`);
    if (market.primaryCcy !== 'EUR')
      throw new Error(`${market.id}: non-EUR anchors arrive in M3 (ADR-0017)`);
    this.model = new FvModel({
      primary: { venue: market.primaryMic, symbol: market.primarySymbol },
      ...(market.tradegateSymbol === undefined
        ? {}
        : { tradegate: { venue: 'TGAT' as const, symbol: market.tradegateSymbol } }),
      ...(market.adr === undefined
        ? {}
        : {
            adr: {
              ref: { venue: market.adr.venue, symbol: market.adr.symbol },
              verified: market.adr.verified,
            },
          }),
      fx: { venue: 'FX', symbol: 'EURUSD' },
      params,
    });
  }

  instruments() {
    return this.model.instruments();
  }

  onTick(t: Tick): void {
    this.model.onTick(t);
  }

  /** Evaluates at `ts`; undefined until the first anchor is known. */
  evaluate(ts: number): PipelineOutput | undefined {
    const window = this.calendar.windowAt(
      { primary: this.market.primaryMic, extended: this.market.extendedMic },
      ts,
    );
    const adrLive =
      this.market.adr !== undefined && this.calendar.isVenueOpen(this.market.adr.venue, ts);
    const snapshot = this.model.evaluate(ts, { window, adrLive });
    if (snapshot === undefined) return undefined;
    const update = toEngineUpdate(snapshot, {
      tickSize: this.tickSize,
      prevMark: this.prev?.mark,
      dtMs: this.prev === undefined ? 0 : ts - this.prev.ts,
      stepCapBpsPerSecond: this.stepCap,
    });
    this.prev = { mark: update.mark, ts };
    return { snapshot, update };
  }
}
