import { CalendarCache, calendarFor, type VenueState } from '@euroedge/calendar';
import {
  allUnderlyings,
  DEFAULT_SIM_CONFIG,
  underlyingLines,
  type Currency,
  type FxPair,
  type InstrumentRef,
  type MarketConfig,
  type SimConfig,
  type Tick,
  type Underlying,
  type UnderlyingLines,
} from '@euroedge/shared';
import { DateTime } from 'luxon';
import { Rng } from './rng.ts';

const SECOND = 1000;
const DAY_S = 86_400;
const SECONDS_PER_YEAR = 365 * DAY_S;
const SQRT_YEAR = Math.sqrt(SECONDS_PER_YEAR);
const BP = 1e-4;
const FX_PAIRS: readonly FxPair[] = ['EURUSD', 'EURGBP', 'EURDKK'];
const FX_HALF_SPREAD_BP: Record<FxPair, number> = { EURUSD: 0.3, EURGBP: 0.5, EURDKK: 0.2 };
const FX_QUOTE_CCY: Record<FxPair, Currency> = { EURUSD: 'USD', EURGBP: 'GBP', EURDKK: 'DKK' };

export type FaultKind = 'bad-print' | 'stale' | 'halt';

/** A fault injected at a fixed time (scenario DSL, M2-12). */
export interface ScheduledFault {
  readonly at: number;
  readonly kind: FaultKind;
  /** Underlying id (market id for stock perps, constituent id otherwise). */
  readonly underlying: string;
  /** stale/halt duration; default 10 min. */
  readonly durationSec?: number;
  /** bad-print deviation; default 500 bp. */
  readonly sizeBp?: number;
}

export interface FaultRecord {
  readonly at: number;
  readonly kind: FaultKind;
  readonly underlying: string;
  readonly until?: number;
}

export interface SimWorldOptions {
  readonly seed: number;
  /** UTC ms, aligned to a whole second. */
  readonly startTs: number;
  /** Stock perps and baskets; every underlying with `sim` parameters is simulated. */
  readonly markets: readonly MarketConfig[];
  readonly config?: SimConfig;
  readonly faults?: readonly ScheduledFault[];
}

interface Dividend {
  readonly gross: number;
  readonly localAt: number;
  readonly adrAt: number;
  localDone: boolean;
  adrDone: boolean;
}

interface SimUnderlying {
  readonly u: Underlying;
  readonly lines: UnderlyingLines;
  readonly overnight: InstrumentRef | undefined;
  readonly adrRatio: number;
  readonly sector: string;
  readonly beta: number;
  readonly idioSigma: number;
  readonly jumpProb: number;
  readonly jumpVol: number;
  readonly closeRandomEndSec: number;
  readonly divs: Dividend[];
  /** Latent log price in EUR, ex every local dividend already passed. */
  logS: number;
  /** ADR basis vs parity, log units (Ornstein–Uhlenbeck). */
  basis: number;
  /** EUR per share the ADR line still carries (+) or already lost (−) vs the local line. */
  adrAdj: number;
  prevPrimary: VenueState;
  pendingClose: number | undefined;
  pendingBadPrintBp: number | undefined;
  staleUntil: number;
  haltUntil: number;
}

interface FxState {
  readonly pair: FxPair;
  readonly mean: number;
  readonly sigma: number;
  readonly kappa: number;
  log: number;
}

const round = (v: number, step: number) => Math.round(v / step) * step;
const r2 = (v: number) => Number(round(v, 0.01).toFixed(2));
const r5 = (v: number) => Number(round(v, 0.00001).toFixed(5));
const startOfLocalDay = (iso: string, tz: string) => DateTime.fromISO(iso, { zone: tz }).toMillis();

/**
 * Deterministic synthetic world (brief §4.2, sim v1). A market factor, sector factors and
 * idiosyncratic noise drive one latent EUR price per underlying; each venue observes it only in
 * its own session (auctions, pre/post-market, US overnight), so off-hours moves surface as gaps.
 * Dividends drop the local and ADR lines on their own ex-dates. Seeded faults (bad prints, stale
 * feeds, halts) exercise the circuit breakers. Ticks for a seed and start are independent of how
 * `advanceTo` calls are chunked.
 */
export class SimWorld {
  private readonly rng: Rng;
  private readonly cfg: SimConfig;
  private readonly unds: SimUnderlying[];
  private readonly sectors: string[];
  private readonly fx: FxState[];
  private readonly sessions = new CalendarCache();
  private readonly scheduled: ScheduledFault[];
  private readonly faultRatePerSecond: number;
  readonly faultLog: FaultRecord[] = [];
  private ts: number;
  private started = false;

  constructor(opts: SimWorldOptions) {
    if (opts.startTs % SECOND !== 0) throw new RangeError('startTs must be a whole second');
    this.rng = new Rng(opts.seed);
    this.cfg = opts.config ?? DEFAULT_SIM_CONFIG;
    this.ts = opts.startTs;
    this.scheduled = [...(opts.faults ?? [])].sort((a, b) => a.at - b.at);
    const f = this.cfg.faults;
    this.faultRatePerSecond = (f.badPrintsPerDay + f.staleFeedsPerDay + f.haltsPerDay) / DAY_S;
    const { marketVol, sectorVol } = this.cfg.factors;
    this.unds = allUnderlyings(opts.markets).flatMap((u): SimUnderlying[] => {
      const sim = u.sim;
      if (sim === undefined) return [];
      const lines = underlyingLines(u);
      const beta = Number(sim.beta ?? '1');
      const total = Number(sim.annualVol);
      const idio = Math.sqrt(
        Math.max(total ** 2 - (beta * marketVol) ** 2 - sectorVol ** 2, 0.05 ** 2),
      );
      const primaryTz = calendarFor(u.primaryMic).tz;
      const adrTz = u.adr === undefined ? primaryTz : calendarFor(u.adr.venue).tz;
      const usAdr = u.adr !== undefined && (u.adr.venue === 'XNYS' || u.adr.venue === 'XNAS');
      return [
        {
          u,
          lines,
          overnight:
            usAdr && u.adr !== undefined ? { venue: 'USON', symbol: u.adr.symbol } : undefined,
          adrRatio: Number(u.adr?.ratio ?? '1'),
          sector: u.sector,
          beta,
          idioSigma: idio / SQRT_YEAR,
          jumpProb: Number(sim.jumpsPerYear) / SECONDS_PER_YEAR,
          jumpVol: Number(sim.jumpVol),
          closeRandomEndSec:
            calendarFor(u.primaryMic).file.regular.phases.closingAuction?.randomEndSec ?? 0,
          divs: sim.dividends.map((d) => ({
            gross: Number(d.gross),
            localAt: startOfLocalDay(d.exDate, primaryTz),
            adrAt: startOfLocalDay(d.adrExDate ?? d.exDate, adrTz),
            localDone: false,
            adrDone: false,
          })),
          logS: Math.log(Number(sim.startPrice)),
          basis: 0,
          adrAdj: 0,
          prevPrimary: 'closed',
          pendingClose: undefined,
          pendingBadPrintBp: undefined,
          staleUntil: 0,
          haltUntil: 0,
        },
      ];
    });
    this.sectors = [...new Set(this.unds.map((x) => x.sector))].sort();
    this.fx = FX_PAIRS.map((pair) => {
      const p = this.cfg.fx[pair];
      return {
        pair,
        mean: Math.log(p.start),
        sigma: p.annualVol / SQRT_YEAR,
        kappa: p.meanReversionPerDay / DAY_S,
        log: Math.log(p.start),
      };
    });
    // Dividends already past at the start are part of the starting price.
    for (const x of this.unds)
      for (const d of x.divs) {
        d.localDone = d.localAt <= this.ts;
        d.adrDone = d.adrAt <= this.ts;
      }
  }

  get now(): number {
    return this.ts;
  }

  /** Latent EUR price (ground truth; used by tests and the informed-arbitrageur bot later). */
  truePrice(id: string): number {
    return Math.exp(this.und(id).logS);
  }

  fxRate(pair: FxPair): number {
    const f = this.fx.find((x) => x.pair === pair);
    if (f === undefined) throw new Error(`unknown pair ${pair}`);
    return Math.exp(f.log);
  }

  /** Advances the world second by second up to `ts` (inclusive) and returns the emitted ticks. */
  advanceTo(ts: number): Tick[] {
    const out: Tick[] = [];
    if (!this.started) {
      this.started = true;
      this.emitPreviousCloses(out);
    }
    while (this.ts + SECOND <= ts) {
      this.ts += SECOND;
      this.step(out);
    }
    return out;
  }

  private und(id: string): SimUnderlying {
    const x = this.unds.find((y) => y.u.id === id);
    if (x === undefined) throw new Error(`unknown underlying ${id}`);
    return x;
  }

  /** EUR → currency of a line. */
  private ccyFactor(ccy: Currency): number {
    switch (ccy) {
      case 'EUR':
        return 1;
      case 'USD':
        return this.fxRate('EURUSD');
      case 'GBP':
        return this.fxRate('EURGBP');
      case 'GBX':
        return this.fxRate('EURGBP') * 100;
      case 'DKK':
        return this.fxRate('EURDKK');
    }
  }

  private adrMid(x: SimUnderlying): number {
    return (Math.exp(x.logS) + x.adrAdj) * x.adrRatio * this.fxRate('EURUSD') * Math.exp(x.basis);
  }

  /** Synthetic "previous close" snapshot at start so consumers have anchors immediately. */
  private emitPreviousCloses(out: Tick[]): void {
    for (const x of this.unds) {
      const px = Math.exp(x.logS) * this.ccyFactor(x.u.primaryCcy);
      out.push(this.tick(x.lines.primary, x.u.primaryCcy, 'close', { last: r2(px) }));
      if (x.lines.adr !== undefined)
        out.push(this.tick(x.lines.adr, 'USD', 'close', { last: r2(this.adrMid(x)) }));
    }
    for (const f of this.fx)
      out.push(
        this.tick({ venue: 'FX', symbol: f.pair }, FX_QUOTE_CCY[f.pair], 'close', {
          last: r5(Math.exp(f.log)),
        }),
      );
  }

  private step(out: Tick[]): void {
    const ts = this.ts;
    const rng = this.rng;
    const fxOpen = this.sessions.isVenueOpen('FX', ts);
    if (fxOpen)
      for (const f of this.fx) f.log += f.kappa * (f.mean - f.log) + f.sigma * rng.normal();
    const m = (this.cfg.factors.marketVol / SQRT_YEAR) * rng.normal();
    const sectorMoves = new Map(
      this.sectors.map((s) => [s, (this.cfg.factors.sectorVol / SQRT_YEAR) * rng.normal()]),
    );
    while (this.scheduled.length > 0 && (this.scheduled[0]?.at ?? Infinity) <= ts) {
      const f = this.scheduled.shift();
      if (f !== undefined)
        this.applyFault(this.und(f.underlying), f.kind, f.durationSec ?? 600, f.sizeBp ?? 500);
    }

    for (const x of this.unds) {
      const primary = this.sessions.venueState(x.u.primaryMic, ts);
      // News arrives around the clock; off-hours variance is lower than in the session.
      const volScale = primary === 'continuous' ? 1.3 : 0.6;
      x.logS +=
        volScale * (x.beta * m + (sectorMoves.get(x.sector) ?? 0) + x.idioSigma * rng.normal());
      if (rng.chance(x.jumpProb)) x.logS += x.jumpVol * rng.normal();
      x.basis += -0.0005 * x.basis + 0.2 * BP * rng.normal();
      this.applyDividends(x, ts);
      if (this.faultRatePerSecond > 0 && rng.chance(this.faultRatePerSecond)) {
        const f = this.cfg.faults;
        const u = rng.uniform() * (f.badPrintsPerDay + f.staleFeedsPerDay + f.haltsPerDay);
        const kind: FaultKind =
          u < f.badPrintsPerDay
            ? 'bad-print'
            : u < f.badPrintsPerDay + f.staleFeedsPerDay
              ? 'stale'
              : 'halt';
        this.applyFault(
          x,
          kind,
          300 + Math.floor(rng.uniform() * 600),
          300 + Math.floor(rng.uniform() * 700),
        );
      }
      this.emitPrimary(x, primary, out);
      this.emitTradegate(x, out);
      this.emitAdr(x, out);
      x.prevPrimary = primary;
    }
    if (fxOpen)
      for (const f of this.fx) {
        const mid = Math.exp(f.log);
        const half = FX_HALF_SPREAD_BP[f.pair] * BP;
        out.push(
          this.tick({ venue: 'FX', symbol: f.pair }, FX_QUOTE_CCY[f.pair], 'quote', {
            bid: r5(mid * (1 - half)),
            ask: r5(mid * (1 + half)),
          }),
        );
      }
  }

  private applyDividends(x: SimUnderlying, ts: number): void {
    for (const d of x.divs) {
      if (!d.localDone && ts >= d.localAt) {
        const s = Math.exp(x.logS);
        x.logS = Math.log(Math.max(s - d.gross, s * 0.01));
        x.adrAdj += d.gross;
        d.localDone = true;
      }
      if (!d.adrDone && ts >= d.adrAt) {
        x.adrAdj -= d.gross;
        d.adrDone = true;
      }
    }
  }

  private applyFault(x: SimUnderlying, kind: FaultKind, durationSec: number, sizeBp: number): void {
    const ts = this.ts;
    if (kind === 'bad-print') {
      x.pendingBadPrintBp = this.rng.chance(0.5) ? sizeBp : -sizeBp;
      this.faultLog.push({ at: ts, kind, underlying: x.u.id });
    } else {
      const until = ts + durationSec * SECOND;
      if (kind === 'stale') x.staleUntil = until;
      else x.haltUntil = until;
      this.faultLog.push({ at: ts, kind, underlying: x.u.id, until });
    }
  }

  private emitPrimary(x: SimUnderlying, state: VenueState, out: Tick[]): void {
    const ts = this.ts;
    const rng = this.rng;
    const ccy = x.u.primaryCcy;
    const px = Math.exp(x.logS) * this.ccyFactor(ccy);
    const ref = x.lines.primary;
    const halted = ts < x.haltUntil;
    if (x.prevPrimary === 'openingAuction' && state === 'continuous' && !halted)
      out.push(this.tick(ref, ccy, 'auction', { last: r2(px), size: 20_000 }));
    // Closing auction: the official close prints at the scheduled end plus a random delay.
    if (x.prevPrimary === 'closingAuction' && state !== 'closingAuction')
      x.pendingClose = ts + Math.floor(rng.uniform() * (x.closeRandomEndSec + 1)) * SECOND;
    if (x.pendingClose !== undefined && ts >= x.pendingClose) {
      x.pendingClose = undefined;
      out.push(this.tick(ref, ccy, 'close', { last: r2(px), size: 50_000 }));
    }
    if (halted) return;
    if (state === 'continuous' && rng.chance(1 / 3)) {
      let last = px * Math.exp(2 * BP * rng.normal());
      if (x.pendingBadPrintBp !== undefined) {
        last = px * (1 + x.pendingBadPrintBp * BP);
        x.pendingBadPrintBp = undefined;
      }
      out.push(
        this.tick(ref, ccy, 'trade', { last: r2(last), size: 1 + Math.floor(rng.uniform() * 200) }),
      );
    } else if (
      (state === 'openingAuction' || state === 'closingAuction') &&
      ts % (10 * SECOND) === 0
    ) {
      out.push(
        this.tick(ref, ccy, 'indicative', { last: r2(px * Math.exp(5 * BP * rng.normal())) }),
      );
    }
  }

  private emitTradegate(x: SimUnderlying, out: Tick[]): void {
    const ref = x.lines.tradegate;
    if (ref === undefined || this.ts < x.staleUntil || !this.sessions.isVenueOpen('TGAT', this.ts))
      return;
    const rng = this.rng;
    if (!rng.chance(0.5)) return;
    const mid = Math.exp(x.logS) * Math.exp(3 * BP * rng.normal());
    const half = mid * (3 + Math.abs(rng.normal()) * 2) * BP;
    out.push(this.tick(ref, 'EUR', 'quote', { bid: r2(mid - half), ask: r2(mid + half) }));
  }

  private emitAdr(x: SimUnderlying, out: Tick[]): void {
    const adr = x.lines.adr;
    if (adr === undefined) return;
    const rng = this.rng;
    const state = this.sessions.venueState(adr.venue, this.ts);
    // Regular session, then pre/post-market, then the US overnight venue: thinner and wider.
    let ref: InstrumentRef = adr;
    let p = 0.5;
    let spreadBp = 2;
    if (state === 'preOpen' || state === 'postTrading') {
      p = 0.2;
      spreadBp = 8;
    } else if (state !== 'continuous') {
      if (x.overnight === undefined || !this.sessions.isVenueOpen('USON', this.ts)) return;
      ref = x.overnight;
      p = 0.1;
      spreadBp = 15;
    }
    if (!rng.chance(p)) return;
    const mid = this.adrMid(x) * Math.exp(4 * BP * rng.normal());
    const half = mid * spreadBp * BP;
    out.push(this.tick(ref, 'USD', 'quote', { bid: r2(mid - half), ask: r2(mid + half) }));
  }

  private tick(
    instrument: InstrumentRef,
    currency: Currency,
    kind: Tick['kind'],
    px: Pick<Tick, 'bid' | 'ask' | 'last' | 'size'>,
  ): Tick {
    return { source: 'sim', instrument, ts: this.ts, currency, kind, ...px };
  }
}
