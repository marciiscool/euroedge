/**
 * Mark update in integer ticks (ADR-0009): step-capped toward the target, then clamped to
 * fvBand. The band dominates; any clamp is reported so the engine logs it.
 */
export interface MarkStepInput {
  /** Previous mark; undefined on the first update. */
  readonly prev: bigint | undefined;
  readonly target: bigint;
  readonly bandLo: bigint;
  readonly bandHi: bigint;
  /** Time since the previous mark, ms. */
  readonly dtMs: number;
  readonly stepCapBpsPerSecond: number;
  /** During SNAP the step cap is suspended (brief §6.4). */
  readonly suspendStepCap?: boolean;
}

export interface MarkStep {
  readonly mark: bigint;
  /** True when the band, not the step cap, decided the mark. */
  readonly clamped: boolean;
}

const clampBig = (v: bigint, lo: bigint, hi: bigint) => (v < lo ? lo : v > hi ? hi : v);

export function stepMark(i: MarkStepInput): MarkStep {
  if (i.bandLo > i.bandHi) throw new RangeError('bandLo > bandHi');
  let stepped = i.target;
  if (i.prev !== undefined && i.suspendStepCap !== true) {
    // Max move = prev · cap · Δt, rounded up so the mark can always move at least one tick.
    const num = i.prev * BigInt(i.stepCapBpsPerSecond) * BigInt(Math.max(0, Math.round(i.dtMs)));
    const den = 10_000_000n;
    const maxStep = num === 0n ? 1n : (num + den - 1n) / den;
    stepped = i.prev + clampBig(i.target - i.prev, -maxStep, maxStep);
  }
  const mark = clampBig(stepped, i.bandLo, i.bandHi);
  return { mark, clamped: mark !== stepped };
}
