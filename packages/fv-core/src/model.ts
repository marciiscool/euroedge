import type { Currency, FvParams, InstrumentRef, Tick, Window } from '@euroedge/shared';
import { instrumentKey } from '@euroedge/shared';
import {
  band,
  combine,
  confidenceOf,
  median3,
  widenSigma,
  type Confidence,
  type Signal,
  type SignalKind,
} from './combine.ts';

/** A dividend as seen by each line: local and ADR ex-instants (local midnight of each venue). */
export interface DividendEvent {
  readonly gross: number;
  readonly localExTs: number;
  readonly adrExTs: number;
}

export interface FvModelConfig {
  readonly primary: InstrumentRef;
  /** Currency of the primary line; GBX/GBP via EURGBP, DKK via EURDKK (ADR-0017). Default EUR. */
  readonly primaryCcy?: Currency;
  /** The EURGBP/EURDKK feed converting the primary line to EUR. */
  readonly conversionFx?: InstrumentRef;
  readonly tradegate?: InstrumentRef;
  readonly adr?: { readonly ref: InstrumentRef; readonly verified: boolean };
  /** EURUSD, for the ADR signal. */
  readonly fx: InstrumentRef;
  readonly dividends?: readonly DividendEvent[];
  readonly params: FvParams;
}

export interface EvaluateContext {
  readonly window: Window;
  /** The ADR's venue is in session (from the calendar; brief §6.1 "only when live"). */
  readonly adrLive: boolean;
}

export interface SourceContribution {
  readonly kind: SignalKind;
  readonly weight: number;
  readonly ageMs: number;
  /** EUR price implied by this signal alone: C·e^(s_k). */
  readonly implied: number;
}

export interface FvSnapshot {
  readonly ts: number;
  readonly window: Window;
  readonly anchor: { readonly price: number; readonly ts: number };
  readonly fv: number;
  /** σ_FV, log units. */
  readonly sigma: number;
  readonly bandLo: number;
  readonly bandHi: number;
  readonly confidence: Confidence;
  /** Index (brief §6.2): Window A median{primary, Tradegate, FV}, otherwise FV. */
  readonly index: number;
  readonly sources: readonly SourceContribution[];
  /** ADR basis b_A in use, log units. */
  readonly basis: number;
  /** EURDKK beyond the peg alert threshold, or no EURDKK feed (peg fallback in use). */
  readonly fxAlert: boolean;
}

interface Obs {
  value: number;
  ts: number;
}

/**
 * Stateful FV model for one market (brief §6.1): Tradegate + ADR signals over a EUR anchor
 * converted from GBX/DKK lines at t_C, dividends per line, ADR basis EWMA. Pure apart from its
 * own state. Snap arrives in M3-08.
 */
export class FvModel {
  private readonly cfg: FvModelConfig;
  private readonly keys: { primary: string; tg?: string; adr?: string; fx: string; conv?: string };
  /** Anchor in the primary line's own currency, and the conversion rate at t_C. */
  private anchor: Obs | undefined;
  private convRef: Obs | undefined;
  private conv: Obs | undefined;
  /** ADR basis b_A (EWMA of close-to-open residuals) and whether this anchor's open was seen. */
  private basis = 0;
  private openSeen = true;
  private adrRef: Obs | undefined;
  private fxRef: Obs | undefined;
  private primary: Obs | undefined;
  private tg: { bid: number; ask: number; ts: number } | undefined;
  private adr: Obs | undefined;
  private fx: Obs | undefined;
  /** Last FV state: value, variance (log²) and time, carried while no signal is live. */
  private last: { fv: number; variance: number; ts: number } | undefined;
  private everLive = false;

  constructor(cfg: FvModelConfig) {
    this.cfg = cfg;
    this.keys = {
      primary: instrumentKey(cfg.primary),
      fx: instrumentKey(cfg.fx),
      ...(cfg.tradegate === undefined ? {} : { tg: instrumentKey(cfg.tradegate) }),
      ...(cfg.adr === undefined ? {} : { adr: instrumentKey(cfg.adr.ref) }),
      ...(cfg.conversionFx === undefined ? {} : { conv: instrumentKey(cfg.conversionFx) }),
    };
  }

  /** Instruments this model consumes. */
  instruments(): InstrumentRef[] {
    return [
      this.cfg.primary,
      this.cfg.fx,
      ...(this.cfg.tradegate === undefined ? [] : [this.cfg.tradegate]),
      ...(this.cfg.adr === undefined ? [] : [this.cfg.adr.ref]),
      ...(this.cfg.conversionFx === undefined ? [] : [this.cfg.conversionFx]),
    ];
  }

  /** Primary-currency units per EUR at `obs` (1 for EUR lines). */
  private convRate(obs: Obs | undefined): number | undefined {
    switch (this.cfg.primaryCcy ?? 'EUR') {
      case 'EUR':
        return 1;
      case 'GBP':
        return obs?.value;
      case 'GBX':
        return obs === undefined ? undefined : obs.value * 100;
      case 'DKK':
        // ERM II peg: without a feed, the central rate stands in (and raises the alert).
        return obs?.value ?? this.cfg.params.dkkPeg.central;
      case 'USD':
        return undefined;
    }
  }

  private fxAlert(): boolean {
    if (this.cfg.primaryCcy !== 'DKK') return false;
    const peg = this.cfg.params.dkkPeg;
    if (this.conv === undefined) return true;
    return Math.abs(this.conv.value / peg.central - 1) > peg.alertBp * 1e-4;
  }

  /** Dividends (EUR) whose ex-instant on a line falls in (t_C, ts]. */
  private divSince(ts: number, line: 'local' | 'adr'): number {
    const tC = this.anchor?.ts ?? ts;
    let d = 0;
    for (const x of this.cfg.dividends ?? []) {
      const at = line === 'local' ? x.localExTs : x.adrExTs;
      if (at > tC && at <= ts) d += x.gross;
    }
    return d;
  }

  /** Raw ADR-implied local EUR price, cum/ex-adjusted to the local line at `ts`. */
  private adrImplied(ts: number, cEur: number): number | undefined {
    const adr = this.adr;
    if (
      adr === undefined ||
      this.adrRef === undefined ||
      this.fxRef === undefined ||
      this.fx === undefined
    )
      return undefined;
    const raw = cEur * (adr.value / this.adrRef.value) * (this.fxRef.value / this.fx.value);
    // Put the ADR on the local line's dividend footing (brief §6.1: each line has its own ex-date).
    return raw + this.divSince(ts, 'adr') - this.divSince(ts, 'local');
  }

  onTick(t: Tick): void {
    const key = instrumentKey(t.instrument);
    const px = mid(t);
    if (px === undefined) return;
    if (key === this.keys.primary) {
      if (t.kind === 'close') {
        // New anchor C at t_C. ADR/FX references are their values at t_C (set below as
        // observations at or before t_C arrive, including ones with the same timestamp).
        this.anchor = { value: px, ts: t.ts };
        this.adrRef = this.adr !== undefined && this.adr.ts <= t.ts ? { ...this.adr } : undefined;
        this.fxRef = this.fx !== undefined && this.fx.ts <= t.ts ? { ...this.fx } : undefined;
        this.convRef =
          this.conv !== undefined && this.conv.ts <= t.ts ? { ...this.conv } : undefined;
        this.openSeen = false;
      } else if (t.kind === 'trade' || t.kind === 'auction') {
        const rate = this.convRate(this.conv);
        if (rate === undefined) return;
        this.primary = { value: px / rate, ts: t.ts };
        if (!this.openSeen) {
          this.openSeen = true;
          this.learnBasis(t.ts);
        }
      }
    } else if (key === this.keys.tg && t.bid !== undefined && t.ask !== undefined) {
      this.tg = { bid: t.bid, ask: t.ask, ts: t.ts };
    } else if (key === this.keys.adr && t.kind !== 'indicative') {
      this.adr = { value: px, ts: t.ts };
      if (this.anchor !== undefined && t.ts <= this.anchor.ts) this.adrRef = { ...this.adr };
    } else if (key === this.keys.fx) {
      this.fx = { value: px, ts: t.ts };
      if (this.anchor !== undefined && t.ts <= this.anchor.ts) this.fxRef = { ...this.fx };
    }
    if (key === this.keys.conv) {
      this.conv = { value: px, ts: t.ts };
      if (this.anchor !== undefined && t.ts <= this.anchor.ts) this.convRef = { ...this.conv };
    }
  }

  /** Anchor C in EUR, ex every local dividend since t_C (brief §6.1). */
  private anchorEur(ts: number): number | undefined {
    if (this.anchor === undefined) return undefined;
    const rate = this.convRate(this.convRef ?? this.conv);
    if (rate === undefined) return undefined;
    return this.anchor.value / rate - this.divSince(ts, 'local');
  }

  /**
   * M3-03: at the first primary print after a new anchor, the residual between the ADR-implied
   * move and the actual open updates b_A = EWMA(residual) with the configured half-life.
   */
  private learnBasis(ts: number): void {
    if (this.cfg.adr?.verified !== true || this.primary === undefined) return;
    const c = this.anchorEur(ts);
    if (c === undefined) return;
    const implied = this.adrImplied(ts, c + this.divSince(ts, 'local'));
    if (implied === undefined) return;
    const residual = Math.log(implied / c) - Math.log(this.primary.value / c);
    const alpha = 1 - 2 ** (-1 / this.cfg.params.basisHalfLifeDays);
    this.basis += alpha * (residual - this.basis);
  }

  evaluate(ts: number, ctx: EvaluateContext): FvSnapshot | undefined {
    const anchor = this.anchor;
    const C = this.anchorEur(ts);
    if (anchor === undefined || C === undefined) return undefined;
    const p = this.cfg.params;
    const w = ctx.window;
    const maxAgeMs = p.maxSignalAgeSeconds * 1000;
    const signals: Signal[] = [];

    const tgMid = this.freshTradegateMid(ts);
    if (tgMid !== undefined && this.tg !== undefined) {
      signals.push({
        kind: 'tradegate',
        s: Math.log(tgMid / C),
        sigmaBp: p.signalSigmaBp.tradegate[w],
        ageSeconds: (ts - this.tg.ts) / 1000,
      });
    }
    const adr = this.adr;
    const implied =
      this.cfg.adr?.verified === true && ctx.adrLive && adr !== undefined && ts - adr.ts <= maxAgeMs
        ? this.adrImplied(ts, C + this.divSince(ts, 'local'))
        : undefined;
    if (implied !== undefined && adr !== undefined) {
      // Return form, not level parity: s_A = ln(ADR_t/ADR_tC) − ln(FX_t/FX_tC) − b_A,
      // with each line's dividends applied on its own ex-date.
      signals.push({
        kind: 'adr',
        s: Math.log(implied / C) - this.basis,
        sigmaBp: p.signalSigmaBp.adr[w],
        ageSeconds: (ts - adr.ts) / 1000,
      });
    }

    const comb = combine(signals, {
      stalenessBp2PerSecond: p.stalenessBp2PerSecond,
      phi: p.phi,
      sigmaFloorBp: p.sigmaFloorBp[w],
    });
    const floor = p.sigmaFloorBp[w] * 1e-4;
    let fv: number;
    let sigma: number;
    if (comb !== undefined) {
      fv = C * Math.exp(comb.s);
      sigma = comb.sigma;
      this.everLive = true;
    } else if (this.last !== undefined) {
      // No live signal: FV_t = FV_last, σ widens with q[window]·Δt.
      fv = this.last.fv;
      sigma = Math.max(
        floor,
        widenSigma(Math.sqrt(this.last.variance), p.widenBp2PerHour[w], ts - this.last.ts),
      );
    } else {
      fv = C;
      sigma = floor;
    }
    this.last = { fv, variance: sigma * sigma, ts };

    const [bandLo, bandHi] = band(fv, sigma, p.bandSigmas);
    let index = fv;
    if (w === 'A' && tgMid !== undefined) {
      const primaryFresh = this.primary !== undefined && ts - this.primary.ts <= maxAgeMs;
      // Window A: median of three; with the primary missing, Tradegate alone (ADR-0008).
      index =
        primaryFresh && this.primary !== undefined ? median3(this.primary.value, tgMid, fv) : tgMid;
    }

    return {
      ts,
      window: w,
      anchor: { price: C, ts: anchor.ts },
      basis: this.basis,
      fxAlert: this.fxAlert(),
      fv,
      sigma,
      bandLo,
      bandHi,
      confidence: this.everLive ? confidenceOf(sigma, p.confidenceBp) : 'none',
      index,
      sources: (comb?.signals ?? []).map((s) => ({
        kind: s.kind,
        weight: s.weight,
        ageMs: Math.round(s.ageSeconds * 1000),
        implied: C * Math.exp(s.s),
      })),
    };
  }

  private freshTradegateMid(ts: number): number | undefined {
    const tg = this.tg;
    const p = this.cfg.params;
    if (tg === undefined || ts - tg.ts > p.maxSignalAgeSeconds * 1000) return undefined;
    const m = (tg.bid + tg.ask) / 2;
    if ((tg.ask - tg.bid) / m > p.tradegateMaxSpreadBp * 1e-4) return undefined;
    return m;
  }
}

function mid(t: Tick): number | undefined {
  if (t.bid !== undefined && t.ask !== undefined) return (t.bid + t.ask) / 2;
  return t.last;
}
