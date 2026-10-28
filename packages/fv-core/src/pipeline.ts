import { CalendarCache, calendarFor } from '@euroedge/calendar';
import { DateTime } from 'luxon';
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
  private prev: { mark: bigint; ts: number; bandLo: number; bandHi: number } | undefined;
  private readonly primaryKey: string;
  private snap: { price: number; ts: number; outsideBand: boolean | undefined } | undefined;
  private readonly params: FvParams;

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
    this.params = params;
    this.primaryKey = `${market.primaryMic}:${market.primarySymbol ?? ''}`;
    if (market.kind !== 'stock' || market.primarySymbol === undefined)
      throw new Error(`${market.id}: baskets use BasketFvPipeline`);
    const ccy = market.primaryCcy;
    const conversionPair =
      ccy === 'GBX' || ccy === 'GBP' ? 'EURGBP' : ccy === 'DKK' ? 'EURDKK' : undefined;
    const primaryTz = calendarFor(market.primaryMic).tz;
    const adrTz = market.adr === undefined ? primaryTz : calendarFor(market.adr.venue).tz;
    const midnight = (iso: string, zone: string) => DateTime.fromISO(iso, { zone }).toMillis();
    // Sim tier: the simulated dividend calendar; live tiers read dividendCalendarRef (M4 corporate actions).
    const dividends = (market.sim?.dividends ?? []).map((d) => ({
      gross: Number(d.gross),
      localExTs: midnight(d.exDate, primaryTz),
      adrExTs: midnight(d.adrExDate ?? d.exDate, adrTz),
    }));
    this.model = new FvModel({
      primary: { venue: market.primaryMic, symbol: market.primarySymbol },
      primaryCcy: ccy,
      ...(conversionPair === undefined
        ? {}
        : { conversionFx: { venue: 'FX' as const, symbol: conversionPair } }),
      dividends,
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

  /** Warm-start groups: one group, primary first (fv-service fetches the anchor from it). */
  warmGroups() {
    return [this.model.instruments()];
  }

  onTick(t: Tick): void {
    this.model.onTick(t);
    // Snap source (sim and real-time primary): the official opening-auction print, never indicatives.
    if (
      t.kind === 'auction' &&
      `${t.instrument.venue}:${t.instrument.symbol}` === this.primaryKey
    ) {
      const p = this.model.lastPrimary();
      if (p !== undefined && p.ts === t.ts)
        this.snap = { price: p.value, ts: t.ts, outsideBand: undefined };
    }
  }

  /** Evaluates at `ts`; undefined until the first anchor is known. */
  evaluate(ts: number): PipelineOutput | undefined {
    const window = this.calendar.windowAt(
      { primary: this.market.primaryMic, extended: this.market.extendedMic },
      ts,
    );
    const adrLive =
      this.market.adr !== undefined && this.calendar.isVenueOpen(this.market.adr.venue, ts);
    const raw = this.model.evaluate(ts, { window, adrLive });
    if (raw === undefined) return undefined;
    const snapshot = this.applySnap(raw, ts);
    const snapping = snapshot.snap !== undefined;
    const update = toEngineUpdate(snapshot, {
      tickSize: this.tickSize,
      prevMark: this.prev?.mark,
      dtMs: this.prev === undefined ? 0 : ts - this.prev.ts,
      // The 50 bp/s step cap is suspended during SNAP; the band still clamps (ADR-0009).
      stepCapBpsPerSecond: snapping ? 1_000_000 : this.stepCap,
    });
    this.prev = { mark: update.mark, ts, bandLo: snapshot.bandLo, bandHi: snapshot.bandHi };
    return { snapshot, update };
  }

  /**
   * SNAP (brief §6.4): for `capSuspendSeconds` after the opening print, FV, index and the band
   * centre move to the snap price. An open outside the prior band is flagged (→ reduce-only).
   */
  private applySnap(s: FvSnapshot, ts: number): FvSnapshot {
    const snap = this.snap;
    if (snap === undefined || ts < snap.ts) return s;
    if (ts - snap.ts >= this.params.snap.capSuspendSeconds * 1000) {
      this.snap = undefined;
      return s;
    }
    if (snap.outsideBand === undefined)
      snap.outsideBand =
        this.prev !== undefined && (snap.price < this.prev.bandLo || snap.price > this.prev.bandHi);
    const k = snap.price / s.fv;
    return {
      ...s,
      fv: snap.price,
      index: snap.price,
      bandLo: s.bandLo * k,
      bandHi: s.bandHi * k,
      snap: { price: snap.price, ts: snap.ts, outsideBand: snap.outsideBand },
    };
  }
}
