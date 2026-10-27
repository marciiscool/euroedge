import type { FvParams, InstrumentRef, Tick, Window } from '@euroedge/shared';
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

export interface FvModelConfig {
  readonly primary: InstrumentRef;
  readonly tradegate?: InstrumentRef;
  readonly adr?: { readonly ref: InstrumentRef; readonly verified: boolean };
  readonly fx: InstrumentRef;
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
}

interface Obs {
  value: number;
  ts: number;
}

/**
 * Stateful FV model for one market (brief §6.1, M1 scope: Tradegate + ADR signals, EUR primary;
 * dividends, currencies, basis EWMA and snap arrive in M3). Pure apart from its own state.
 */
export class FvModel {
  private readonly cfg: FvModelConfig;
  private readonly keys: { primary: string; tg?: string; adr?: string; fx: string };
  private anchor: Obs | undefined;
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
    };
  }

  /** Instruments this model consumes. */
  instruments(): InstrumentRef[] {
    return [
      this.cfg.primary,
      this.cfg.fx,
      ...(this.cfg.tradegate === undefined ? [] : [this.cfg.tradegate]),
      ...(this.cfg.adr === undefined ? [] : [this.cfg.adr.ref]),
    ];
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
      } else if (t.kind === 'trade' || t.kind === 'auction') {
        this.primary = { value: px, ts: t.ts };
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
  }

  evaluate(ts: number, ctx: EvaluateContext): FvSnapshot | undefined {
    const anchor = this.anchor;
    if (anchor === undefined) return undefined;
    const p = this.cfg.params;
    const w = ctx.window;
    const C = anchor.value;
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
    if (
      this.cfg.adr?.verified === true &&
      ctx.adrLive &&
      adr !== undefined &&
      ts - adr.ts <= maxAgeMs &&
      this.adrRef !== undefined &&
      this.fxRef !== undefined &&
      this.fx !== undefined
    ) {
      // Return form, not level parity: s_A = ln(ADR_t/ADR_tC) − ln(FX_t/FX_tC) − b_A (b_A = 0 in v0).
      signals.push({
        kind: 'adr',
        s: Math.log(adr.value / this.adrRef.value) - Math.log(this.fx.value / this.fxRef.value),
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
