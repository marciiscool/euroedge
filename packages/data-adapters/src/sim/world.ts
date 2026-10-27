import { CalendarCache } from '@euroedge/calendar';
import type { Currency, InstrumentRef, MarketConfig, Tick } from '@euroedge/shared';
import { Rng } from './rng.ts';

const SECOND = 1000;
const SECONDS_PER_YEAR = 365 * 86_400;
const BP = 1e-4;

export interface SimWorldOptions {
  readonly seed: number;
  /** UTC ms, aligned to a whole second. */
  readonly startTs: number;
  readonly markets: readonly MarketConfig[];
  /** EUR/USD level at start. */
  readonly eurusd?: number;
}

interface SimMarket {
  readonly config: MarketConfig;
  readonly primary: InstrumentRef;
  readonly tradegate: InstrumentRef | undefined;
  readonly adr: { ref: InstrumentRef; ratio: number } | undefined;
  readonly sigmaPerSqrtSecond: number;
  readonly jumpProbPerSecond: number;
  readonly jumpVol: number;
  /** Latent log price (EUR). */
  logS: number;
  /** ADR basis vs parity, log units (Ornstein–Uhlenbeck). */
  basis: number;
}

const round = (v: number, step: number) => Math.round(v / step) * step;
const r2 = (v: number) => Number(round(v, 0.01).toFixed(2));
const r5 = (v: number) => Number(round(v, 0.00001).toFixed(5));

/**
 * Deterministic synthetic market (brief §4.2, M1 scope): one latent price per market, observed
 * by each venue only while it is open, so overnight and weekend moves surface as opening gaps.
 * Ticks for a given seed and start are independent of how `advanceTo` calls are chunked.
 * Faults (bad prints, stale feeds), dividends and multi-asset correlation arrive in M2.
 */
export class SimWorld {
  private readonly rng: Rng;
  private readonly markets: SimMarket[];
  private readonly sessions = new CalendarCache();
  private ts: number;
  private logFx: number;
  private readonly logFxMean: number;
  private started = false;

  constructor(opts: SimWorldOptions) {
    if (opts.startTs % SECOND !== 0) throw new RangeError('startTs must be a whole second');
    this.rng = new Rng(opts.seed);
    this.ts = opts.startTs;
    this.logFxMean = Math.log(opts.eurusd ?? 1.08);
    this.logFx = this.logFxMean;
    this.markets = opts.markets.map((config) => {
      const sim = config.sim;
      if (sim === undefined) throw new Error(`${config.id} has no sim parameters`);
      return {
        config,
        primary: { venue: config.primaryMic, symbol: config.tradegateSymbol ?? config.id },
        tradegate:
          config.tradegateSymbol === undefined
            ? undefined
            : { venue: 'TGAT', symbol: config.tradegateSymbol },
        adr:
          config.adr === undefined
            ? undefined
            : {
                ref: { venue: config.adr.venue, symbol: config.adr.symbol },
                ratio: Number(config.adr.ratio),
              },
        sigmaPerSqrtSecond: Number(sim.annualVol) / Math.sqrt(SECONDS_PER_YEAR),
        jumpProbPerSecond: Number(sim.jumpsPerYear) / SECONDS_PER_YEAR,
        jumpVol: Number(sim.jumpVol),
        logS: Math.log(Number(sim.startPrice)),
        basis: 0,
      };
    });
  }

  get now(): number {
    return this.ts;
  }

  /** Latent EUR price (ground truth; used by tests and the informed-arbitrageur bot later). */
  truePrice(marketId: string): number {
    const m = this.markets.find((x) => x.config.id === marketId);
    if (m === undefined) throw new Error(`unknown market ${marketId}`);
    return Math.exp(m.logS);
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

  /** Synthetic "previous close" snapshot at start so consumers have anchors immediately. */
  private emitPreviousCloses(out: Tick[]): void {
    const fx = Math.exp(this.logFx);
    for (const m of this.markets) {
      const s = Math.exp(m.logS);
      out.push(this.tick(m.primary, m.config.primaryCcy, 'close', { last: r2(s) }));
      if (m.adr !== undefined) {
        out.push(this.tick(m.adr.ref, 'USD', 'close', { last: r2(s * m.adr.ratio * fx) }));
      }
    }
    out.push(this.tick({ venue: 'FX', symbol: 'EURUSD' }, 'USD', 'close', { last: r5(fx) }));
  }

  private step(out: Tick[]): void {
    const ts = this.ts;
    const rng = this.rng;
    const fxOpen = this.sessions.isVenueOpen('FX', ts);
    if (fxOpen) {
      // Mean-reverting EUR/USD, ~7 % annual vol.
      this.logFx +=
        0.000_001 * (this.logFxMean - this.logFx) +
        (0.07 / Math.sqrt(SECONDS_PER_YEAR)) * rng.normal();
    }
    const fx = Math.exp(this.logFx);

    for (const m of this.markets) {
      const primaryOpen = this.sessions.isVenueOpen(m.primary.venue, ts);
      // News arrives around the clock; off-hours variance is lower than in the session.
      const volScale = primaryOpen ? 1.3 : 0.6;
      m.logS += m.sigmaPerSqrtSecond * volScale * rng.normal();
      if (rng.chance(m.jumpProbPerSecond)) m.logS += m.jumpVol * rng.normal();
      m.basis += -0.0005 * m.basis + 0.2 * BP * rng.normal();
      const s = Math.exp(m.logS);

      if (primaryOpen && rng.chance(1 / 3)) {
        out.push(
          this.tick(m.primary, m.config.primaryCcy, 'trade', {
            last: r2(s * Math.exp(2 * BP * rng.normal())),
            size: 1 + Math.floor(rng.uniform() * 200),
          }),
        );
      }
      // Official closing-auction print at the end of the closing auction (anchor C).
      if (
        this.sessions.isInClosingAuction(m.primary.venue, ts - SECOND) &&
        !this.sessions.isInClosingAuction(m.primary.venue, ts)
      ) {
        out.push(this.tick(m.primary, m.config.primaryCcy, 'close', { last: r2(s), size: 50_000 }));
      }
      if (m.tradegate !== undefined && this.sessions.isVenueOpen('TGAT', ts) && rng.chance(0.5)) {
        const mid = s * Math.exp(3 * BP * rng.normal());
        const half = mid * (3 + Math.abs(rng.normal()) * 2) * BP;
        out.push(
          this.tick(m.tradegate, 'EUR', 'quote', { bid: r2(mid - half), ask: r2(mid + half) }),
        );
      }
      if (
        m.adr !== undefined &&
        this.sessions.isVenueOpen(m.adr.ref.venue, ts) &&
        rng.chance(0.5)
      ) {
        const mid = s * m.adr.ratio * fx * Math.exp(m.basis + 4 * BP * rng.normal());
        const half = mid * 2 * BP;
        out.push(
          this.tick(m.adr.ref, 'USD', 'quote', { bid: r2(mid - half), ask: r2(mid + half) }),
        );
      }
    }
    if (fxOpen) {
      out.push(
        this.tick({ venue: 'FX', symbol: 'EURUSD' }, 'USD', 'quote', {
          bid: r5(fx * (1 - 0.3 * BP)),
          ask: r5(fx * (1 + 0.3 * BP)),
        }),
      );
    }
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
