/**
 * Pure fair-value combination maths (brief §6.1). Floats are allowed only inside fv-core;
 * results leave the package quantized to integer ticks (quantize.ts).
 * Conventions: returns are natural-log returns; σ inputs in basis points.
 */

export type SignalKind = 'tradegate' | 'adr';

export interface Signal {
  readonly kind: SignalKind;
  /** Log return since the anchor time t_C. */
  readonly s: number;
  /** Signal noise σ_k for the current window, bp. */
  readonly sigmaBp: number;
  /** Age of the newest observation, seconds. */
  readonly ageSeconds: number;
}

export interface CombineParams {
  /** λ: variance added per second of age, bp². */
  readonly stalenessBp2PerSecond: number;
  /** φ ≥ 1, correlation inflation. */
  readonly phi: number;
  /** σ floor for the current window, bp. */
  readonly sigmaFloorBp: number;
}

export interface WeightedSignal extends Signal {
  readonly weight: number;
}

export interface Combination {
  /** ŝ = Σ w_k s_k. */
  readonly s: number;
  /** σ_FV in log units. */
  readonly sigma: number;
  readonly signals: readonly WeightedSignal[];
}

const BP = 1e-4;

/** v_k = σ_k² + λ·age_k (bp²) — the one definition used everywhere. */
export const signalVarianceBp2 = (sig: Signal, p: CombineParams): number =>
  sig.sigmaBp * sig.sigmaBp + p.stalenessBp2PerSecond * sig.ageSeconds;

/**
 * Inverse-variance combination: w_k = (1/v_k) / Σ(1/v_j), ŝ = Σ w_k s_k,
 * σ_FV = max(σ_floor, φ · (Σ 1/v_k)^(−1/2)). Returns undefined without signals.
 */
export function combine(signals: readonly Signal[], p: CombineParams): Combination | undefined {
  if (signals.length === 0) return undefined;
  const precisions = signals.map((sig) => {
    const v = signalVarianceBp2(sig, p);
    if (!(v > 0)) throw new RangeError(`signal ${sig.kind} has non-positive variance`);
    return 1 / v;
  });
  const total = precisions.reduce((a, b) => a + b, 0);
  const weighted = signals.map((sig, i) => ({ ...sig, weight: (precisions[i] ?? 0) / total }));
  const s = weighted.reduce((acc, w) => acc + w.weight * w.s, 0);
  const sigmaBp = Math.max(p.sigmaFloorBp, p.phi * Math.sqrt(1 / total));
  return { s, sigma: sigmaBp * BP, signals: weighted };
}

/** No live signal: σ(t) = sqrt(σ_last² + q·Δt_hours) (brief §6.1). */
export function widenSigma(sigmaLast: number, widenBp2PerHour: number, dtMs: number): number {
  const q = widenBp2PerHour * BP * BP;
  return Math.sqrt(sigmaLast * sigmaLast + q * (dtMs / 3_600_000));
}

/** fvBand = [FV·e^(−kσ), FV·e^(+kσ)]. */
export const band = (fv: number, sigma: number, k: number): [number, number] => [
  fv * Math.exp(-k * sigma),
  fv * Math.exp(k * sigma),
];

export type Confidence = 'high' | 'medium' | 'low' | 'none';

export function confidenceOf(
  sigma: number,
  thresholdsBp: { high: number; medium: number },
): Confidence {
  const bp = sigma / BP;
  if (bp <= thresholdsBp.high) return 'high';
  if (bp <= thresholdsBp.medium) return 'medium';
  return 'low';
}

/** Median of exactly three values (ADR-0008: never a median of two). */
export function median3(a: number, b: number, c: number): number {
  return Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));
}
