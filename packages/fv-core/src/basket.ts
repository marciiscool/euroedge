import { CalendarCache } from '@euroedge/calendar';
import {
  basketConstituents,
  type FvParams,
  type InstrumentRef,
  type MarketConfig,
  type Tick,
} from '@euroedge/shared';
import { band, confidenceOf } from './combine.ts';
import { EwmaCovariance } from './covariance.ts';
import { toEngineUpdate } from './engine-update.ts';
import type { FvSnapshot } from './model.ts';
import { MarketFvPipeline, type PipelineOutput } from './pipeline.ts';

const SAMPLE_MS = 60_000;
/** Below this share of index weight with data, the basket publishes no FV at all. */
export const MIN_BASKET_COVERAGE = 0.5;

interface Member {
  readonly id: string;
  readonly weight: number;
  readonly pipeline: MarketFvPipeline;
  base: number | undefined;
  /** FV at the previous covariance sample. */
  prevFv: number | undefined;
}

export interface BasketSnapshot extends FvSnapshot {
  /** Constituents without data, dropped with weights renormalized (logged and shown in the UI). */
  readonly dropped: readonly string[];
}

/**
 * Basket FV (M3-10/11, brief §5): level = L0 · Σ w_i·FV_i/B_i / Σ w_i over constituents with data,
 * B_i = base prices (sim: configured start prices; live: the engine's rebalance event).
 * σ from the EWMA constituent covariance (no independence assumption).
 */
export class BasketFvPipeline {
  readonly market: MarketConfig;
  private readonly members: Member[];
  private readonly cov: EwmaCovariance;
  private readonly params: FvParams;
  private readonly calendar: CalendarCache;
  private readonly startLevel: number;
  private readonly tickSize: number;
  private readonly stepCap: number;
  private prev: { mark: bigint; ts: number } | undefined;
  private everLive = false;
  private lastSampleTs: number | undefined;

  constructor(
    market: MarketConfig,
    catalog: readonly MarketConfig[],
    params: FvParams,
    stepCapBpsPerSecond: number,
    calendar = new CalendarCache(),
  ) {
    if (market.basket === undefined) throw new Error(`${market.id} is not a basket`);
    this.market = market;
    this.params = params;
    this.calendar = calendar;
    this.startLevel = Number(market.basket.startLevel);
    this.tickSize = Number(market.tickSize);
    this.stepCap = stepCapBpsPerSecond;
    this.members = basketConstituents(market, catalog).map((c) => {
      const u = c.underlying;
      const cfg: MarketConfig = {
        ...u,
        id: `${market.id}:${c.id}`,
        displayName: u.name,
        kind: 'stock',
        extendedMic: 'TGAT',
        quoteCcy: 'EUR',
        tickSize: '0.01',
        lotSize: '0.01',
        minNotional: '10',
        enabled: true,
        ...(u.primaryCcy === 'EUR'
          ? {}
          : { priceSourceOverride: { venue: 'TGAT' as const, ccy: 'EUR' as const } }),
      };
      return {
        id: c.id,
        weight: c.weightBps / 10_000,
        pipeline: new MarketFvPipeline(cfg, params, stepCapBpsPerSecond, calendar),
        base: u.sim === undefined ? undefined : Number(u.sim.startPrice),
        prevFv: undefined,
      };
    });
    this.cov = new EwmaCovariance(this.members.length);
  }

  /** One warm-start group per constituent (primary first). */
  warmGroups(): InstrumentRef[][] {
    return this.members.map((m) => m.pipeline.instruments());
  }

  instruments(): InstrumentRef[] {
    return this.warmGroups().flat();
  }

  onTick(t: Tick): void {
    for (const m of this.members) m.pipeline.onTick(t);
  }

  evaluate(ts: number): PipelineOutput | undefined {
    const outs = this.members.map((m) => m.pipeline.evaluate(ts)?.snapshot);
    const avail: number[] = [];
    outs.forEach((s, i) => {
      const m = this.members[i];
      if (s === undefined || m === undefined) return;
      m.base ??= s.anchor.price;
      avail.push(i);
    });
    const coverage = avail.reduce((a, i) => a + (this.members[i]?.weight ?? 0), 0);
    if (avail.length === 0 || coverage < MIN_BASKET_COVERAGE) return undefined;
    this.sampleReturns(ts, outs);

    const rel = (i: number, pick: (s: FvSnapshot) => number) => {
      const m = this.members[i];
      const s = outs[i];
      return m === undefined || s === undefined || m.base === undefined
        ? 0
        : (m.weight * pick(s)) / m.base;
    };
    const wSum = avail.reduce((a, i) => a + (this.members[i]?.weight ?? 0), 0);
    const level = (pick: (s: FvSnapshot) => number) =>
      (this.startLevel * avail.reduce((a, i) => a + rel(i, pick), 0)) / wSum;
    const fv = level((s) => s.fv);
    const index = level((s) => s.index);
    const anchor = level((s) => s.anchor.price);
    const shares = avail.map((i) => rel(i, (s) => s.fv));
    const total = shares.reduce((a, x) => a + x, 0);
    const w = this.members.map((_, i) => {
      const k = avail.indexOf(i);
      return k < 0 ? 0 : (shares[k] ?? 0) / total;
    });
    const window = this.calendar.windowAt(
      { primary: this.market.primaryMic, extended: this.market.extendedMic },
      ts,
    );
    const sigma = Math.max(
      this.params.sigmaFloorBp[window] * 1e-4,
      this.cov.portfolioSigma(
        w,
        outs.map((s) => s?.sigma ?? 0),
      ),
    );
    if (avail.some((i) => outs[i]?.confidence !== 'none')) this.everLive = true;
    const [bandLo, bandHi] = band(fv, sigma, this.params.bandSigmas);
    const snapshot: BasketSnapshot = {
      ts,
      window,
      anchor: { price: anchor, ts: Math.max(...avail.map((i) => outs[i]?.anchor.ts ?? 0)) },
      fv,
      sigma,
      bandLo,
      bandHi,
      confidence: this.everLive ? confidenceOf(sigma, this.params.confidenceBp) : 'none',
      index,
      sources: [],
      basis: 0,
      fxAlert: avail.some((i) => outs[i]?.fxAlert === true),
      dropped: this.members.filter((_, i) => !avail.includes(i)).map((m) => m.id),
    };
    const update = toEngineUpdate(snapshot, {
      tickSize: this.tickSize,
      prevMark: this.prev?.mark,
      dtMs: this.prev === undefined ? 0 : ts - this.prev.ts,
      stepCapBpsPerSecond: this.stepCap,
    });
    this.prev = { mark: update.mark, ts };
    return { snapshot, update };
  }

  /** One covariance sample per minute: log FV changes of each constituent (NaN when missing). */
  private sampleReturns(ts: number, outs: readonly (FvSnapshot | undefined)[]): void {
    if (this.lastSampleTs !== undefined && ts - this.lastSampleTs < SAMPLE_MS) return;
    this.lastSampleTs = ts;
    const r = this.members.map((m, i) => {
      const fv = outs[i]?.fv;
      const prev = m.prevFv;
      m.prevFv = fv;
      return fv === undefined || prev === undefined ? NaN : Math.log(fv / prev);
    });
    if (r.some((x) => !Number.isNaN(x))) this.cov.update(r);
  }
}
