import { z } from 'zod';

const perWindow = <T extends z.ZodType>(t: T) => z.object({ A: t, B: t, C: t, D: t });
const nonNeg = z.number().nonnegative();

/**
 * Fair-value model parameters (brief §6.1). Seed defaults; fitted by the backtest in M3.
 * Units: σ in basis points of log return; ages in seconds; q in bp² per hour.
 */
export const fvParamsSchema = z.object({
  /** Per-signal noise σ_k by window, bp. */
  signalSigmaBp: z.object({
    tradegate: perWindow(nonNeg),
    adr: perWindow(nonNeg),
  }),
  /** Staleness penalty λ: variance added per second of signal age, bp². */
  stalenessBp2PerSecond: nonNeg,
  /** Correlation-inflation factor φ ≥ 1. */
  phi: z.number().min(1),
  sigmaFloorBp: perWindow(nonNeg),
  /** Band widening without live signals, bp² per hour. */
  widenBp2PerHour: perWindow(nonNeg),
  /** Signal admission filters. */
  tradegateMaxSpreadBp: nonNeg,
  maxSignalAgeSeconds: nonNeg,
  /** Band half-width in σ (fvBand = FV · e^(±k·σ)). */
  bandSigmas: z.number().positive(),
  /** Confidence thresholds on σ_FV, bp. */
  confidenceBp: z.object({ high: nonNeg, medium: nonNeg }),
  /** Half-life of the ADR basis EWMA b_A, in trading days (M3-03). */
  basisHalfLifeDays: z.number().positive().default(20),
  /** EURDKK peg (ERM II): fallback rate without a feed, and the deviation that raises an alert. */
  /** Circuit breakers (brief §6.5, ADR-0008/0009). Seconds of event time. */
  breakers: z
    .object({
      divergenceSigmas: z.number().positive(),
      divergenceSeconds: nonNeg,
      indexStaleSeconds: perWindow(nonNeg),
      tradegateStaleEscalationSeconds: nonNeg,
      tradegateReleaseSeconds: nonNeg,
      basketDrawdownBp: nonNeg,
      basketCooldownSeconds: nonNeg,
      markPinnedSeconds: nonNeg,
    })
    .default({
      divergenceSigmas: 3,
      divergenceSeconds: 60,
      indexStaleSeconds: { A: 15, B: 120, C: 120, D: 120 },
      tradegateStaleEscalationSeconds: 300,
      tradegateReleaseSeconds: 120,
      basketDrawdownBp: 700,
      basketCooldownSeconds: 900,
      markPinnedSeconds: 60,
    }),
  dkkPeg: z
    .object({ central: z.number().positive(), alertBp: nonNeg })
    .default({ central: 7.46038, alertBp: 50 }),
});
export type FvParams = z.infer<typeof fvParamsSchema>;
