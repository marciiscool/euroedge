import type { Window } from '@euroedge/shared';
import type { Confidence } from './combine.ts';
import { stepMark } from './mark.ts';
import type { FvSnapshot } from './model.ts';
import { toTicks, toTicksCeil, toTicksFloor } from './quantize.ts';

/** Engine-facing market-data update: integers only (ADR-0001/0002). */
export interface QuantizedUpdate {
  readonly window: Window;
  readonly fv: bigint;
  readonly bandLo: bigint;
  readonly bandHi: bigint;
  readonly index: bigint;
  readonly mark: bigint;
  /** The band (not the step cap) decided the mark → engine logs MarkClamped (ADR-0009). */
  readonly markClamped: boolean;
  /** σ_FV in ppm of log return (display/risk only). */
  readonly sigmaPpm: bigint;
  readonly confidence: Confidence;
}

export interface QuantizeOptions {
  readonly tickSize: number;
  readonly prevMark: bigint | undefined;
  readonly dtMs: number;
  readonly stepCapBpsPerSecond: number;
}

/** The fv-core boundary: float snapshot → integer ticks, then the ADR-0009 mark step. */
export function toEngineUpdate(snap: FvSnapshot, o: QuantizeOptions): QuantizedUpdate {
  const fv = toTicks(snap.fv, o.tickSize);
  const bandLo = toTicksFloor(snap.bandLo, o.tickSize);
  const bandHi = toTicksCeil(snap.bandHi, o.tickSize);
  const index = toTicks(snap.index, o.tickSize);
  const { mark, clamped } = stepMark({
    prev: o.prevMark,
    target: index,
    bandLo,
    bandHi,
    dtMs: o.dtMs,
    stepCapBpsPerSecond: o.stepCapBpsPerSecond,
  });
  return {
    window: snap.window,
    fv,
    bandLo,
    bandHi,
    index,
    mark,
    markClamped: clamped,
    sigmaPpm: BigInt(Math.round(snap.sigma * 1e6)),
    confidence: snap.confidence,
  };
}
