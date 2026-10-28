import type { FvParams, Window } from '@euroedge/shared';
import type { SourceContribution } from './model.ts';

/** Circuit breakers evaluated from market data (brief §6.5). CB5–CB7 live in the engine (M4). */
export type BreakerId = 'CB1' | 'CB2' | 'CB3' | 'CB3-TG' | 'CB4' | 'CB8' | 'SNAP';

/** Strongest effect wins: freeze > reduce-only > degraded (no opens, wider spreads) > no-opens. */
export type BreakerEffect = 'none' | 'no-opens' | 'degraded' | 'reduce-only';
const RANK: Record<BreakerEffect, number> = {
  none: 0,
  'no-opens': 1,
  degraded: 2,
  'reduce-only': 3,
};
const EFFECT: Record<BreakerId, BreakerEffect> = {
  CB1: 'no-opens',
  CB2: 'reduce-only',
  CB3: 'degraded',
  'CB3-TG': 'reduce-only',
  CB4: 'reduce-only',
  CB8: 'degraded',
  SNAP: 'reduce-only',
};

export interface BreakerInput {
  readonly ts: number;
  readonly window: Window;
  /** σ_FV, log units. */
  readonly sigma: number;
  readonly sources: readonly SourceContribution[];
  /** Tradegate is scheduled open now (calendar). */
  readonly tradegateScheduled: boolean;
  /** Some signal source is scheduled to be live (Tradegate or a verified ADR venue). CB3 only
   *  applies then: off-hours without any live source, FV_last with widening is the design. */
  readonly liveExpected: boolean;
  /** Primary halt / volatility interruption (feed monitor or venue flag). */
  readonly primaryHalted: boolean;
  /** Quantized mark and band (ticks). */
  readonly mark: bigint;
  readonly bandLo: bigint;
  readonly bandHi: bigint;
  /** Reopen snap (brief §6.4): an open outside the prior band → reduce-only for a while. */
  readonly snap?: { readonly ts: number; readonly outsideBand: boolean };
}

export interface BreakerChange {
  readonly id: BreakerId;
  readonly active: boolean;
  readonly at: number;
}

export interface BreakerOutput {
  readonly active: readonly BreakerId[];
  readonly effect: BreakerEffect;
  /** Transitions at this evaluation (engine input events, M3-13). */
  readonly changes: readonly BreakerChange[];
}

/** A condition that must hold `onMs` to trip and be false `offMs` to clear (event time). */
class Hysteresis {
  private since: number | undefined;
  private readonly onMs: number;
  private readonly offMs: number;
  active = false;
  constructor(onMs: number, offMs: number) {
    this.onMs = onMs;
    this.offMs = offMs;
  }
  update(cond: boolean, ts: number): boolean {
    if (cond === this.active) this.since = undefined;
    else {
      this.since ??= ts;
      if (ts - this.since >= (this.active ? this.offMs : this.onMs)) {
        this.active = cond;
        this.since = undefined;
      }
    }
    return this.active;
  }
}

/** Per-market breaker state machine. Deterministic in its inputs (event time only). */
export class MarketBreakers {
  private readonly p: FvParams['breakers'];
  private readonly snapMs: number;
  private snapUntil: number | undefined;
  private readonly cb1: Hysteresis;
  private readonly tg: Hysteresis;
  private readonly cb8: Hysteresis;
  private lastFresh: number | undefined;
  private state = new Set<BreakerId>();

  constructor(params: FvParams) {
    this.p = params.breakers;
    this.snapMs = params.snap.outsideBandReduceOnlySeconds * 1000;
    this.cb1 = new Hysteresis(this.p.divergenceSeconds * 1000, this.p.divergenceSeconds * 1000);
    this.tg = new Hysteresis(
      this.p.tradegateStaleEscalationSeconds * 1000,
      this.p.tradegateReleaseSeconds * 1000,
    );
    this.cb8 = new Hysteresis(this.p.markPinnedSeconds * 1000, this.p.markPinnedSeconds * 1000);
  }

  evaluate(i: BreakerInput, global: readonly BreakerId[] = []): BreakerOutput {
    const next = new Set<BreakerId>(global);
    const tg = i.sources.find((s) => s.kind === 'tradegate');
    const adr = i.sources.find((s) => s.kind === 'adr');
    // CB1: ADR- vs Tradegate-implied FV diverge by more than k·σ for > 60 s.
    const diverged =
      tg !== undefined &&
      adr !== undefined &&
      Math.abs(Math.log(adr.implied / tg.implied)) > this.p.divergenceSigmas * i.sigma;
    if (this.cb1.update(diverged, i.ts)) next.add('CB1');
    if (i.primaryHalted) next.add('CB2');
    if (i.snap?.outsideBand === true) this.snapUntil = i.snap.ts + this.snapMs;
    if (this.snapUntil !== undefined && i.ts < this.snapUntil) next.add('SNAP');
    // CB3: index stale (no fresh signal) beyond the window's limit.
    const freshest = i.sources.reduce((m, s) => Math.min(m, s.ageMs), Infinity);
    if (freshest !== Infinity) this.lastFresh = i.ts - freshest;
    if (
      i.liveExpected &&
      this.lastFresh !== undefined &&
      i.ts - this.lastFresh > this.p.indexStaleSeconds[i.window] * 1000
    )
      next.add('CB3');
    // ADR-0008 escalation: Tradegate stale > 5 min while scheduled → reduce-only; release after 2 min fresh.
    if (this.tg.update(i.tradegateScheduled && tg === undefined, i.ts)) next.add('CB3-TG');
    // CB8 (ADR-0009): mark pinned to a band edge > 60 s; clears after 60 s strictly inside.
    if (this.cb8.update(i.mark <= i.bandLo || i.mark >= i.bandHi, i.ts)) next.add('CB8');

    const changes: BreakerChange[] = [];
    for (const id of next) if (!this.state.has(id)) changes.push({ id, active: true, at: i.ts });
    for (const id of this.state) if (!next.has(id)) changes.push({ id, active: false, at: i.ts });
    this.state = next;
    const active = [...next].sort();
    const effect = active.reduce<BreakerEffect>(
      (e, id) => (RANK[EFFECT[id]] > RANK[e] ? EFFECT[id] : e),
      'none',
    );
    return { active, effect, changes };
  }
}

/** CB4: EE-Blue FV −7 % vs its anchor → every market reduce-only for 15 min, once per anchor. */
export class BasketDrawdownBreaker {
  private readonly p: FvParams['breakers'];
  private until: number | undefined;
  private firedForAnchor: number | undefined;

  constructor(params: FvParams) {
    this.p = params.breakers;
  }

  evaluate(ts: number, fv: number, anchor: { price: number; ts: number }): readonly BreakerId[] {
    // Compared as fv·10⁴ ≤ C·(10⁴ − bp) so the threshold itself is exact.
    if (
      fv * 10_000 <= anchor.price * (10_000 - this.p.basketDrawdownBp) &&
      this.firedForAnchor !== anchor.ts
    ) {
      this.firedForAnchor = anchor.ts;
      this.until = ts + this.p.basketCooldownSeconds * 1000;
    }
    return this.until !== undefined && ts < this.until ? ['CB4'] : [];
  }
}
