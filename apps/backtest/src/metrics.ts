import { z } from 'zod';

/** One FV prediction resolved against the next official open. */
export interface Resolved {
  /** FV error vs the open, bp of log price: 1e4·ln(FV/open). */
  readonly errBp: number;
  /** Naive "last close" error, bp. */
  readonly naiveBp: number;
  readonly inBand: boolean;
  /** Probability integral transform Φ(ln(open/FV)/σ). */
  readonly pit: number;
}

export const metricsSchema = z.object({
  n: z.number().int(),
  maeBp: z.number(),
  rmseBp: z.number(),
  p999AbsBp: z.number(),
  naiveMaeBp: z.number(),
  naiveRmseBp: z.number(),
  /** 1 − MAE/naive MAE: share of the naive error removed. */
  improvement: z.number(),
  /** Share of opens inside the FV band (target 98–99.5 %). */
  bandCoverage: z.number(),
  /** PIT histogram, 10 equal bins (flat when σ is calibrated). */
  pitHistogram: z.array(z.number().int()).length(10),
});
export type Metrics = z.infer<typeof metricsSchema>;

export const reportSchema = z.object({
  version: z.literal(1),
  data: z.array(z.string()),
  evaluateEverySeconds: z.number(),
  markets: z.record(
    z.string(),
    z.object({
      opens: z.number().int(),
      all: metricsSchema,
      byWindow: z.object({
        A: metricsSchema,
        B: metricsSchema,
        C: metricsSchema,
        D: metricsSchema,
      }),
    }),
  ),
  notes: z.array(z.string()),
});
export type BacktestReport = z.infer<typeof reportSchema>;

const round = (x: number, d = 2) => (Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : 0);

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1);
  return sorted[Math.max(0, i)] ?? 0;
}

export function summarize(rs: readonly Resolved[]): Metrics {
  const n = rs.length;
  const mean = (f: (r: Resolved) => number) => (n === 0 ? 0 : rs.reduce((a, r) => a + f(r), 0) / n);
  const mae = mean((r) => Math.abs(r.errBp));
  const naiveMae = mean((r) => Math.abs(r.naiveBp));
  const hist = Array.from({ length: 10 }, () => 0);
  for (const r of rs) {
    const b = Math.min(9, Math.max(0, Math.floor(r.pit * 10)));
    hist[b] = (hist[b] ?? 0) + 1;
  }
  return {
    n,
    maeBp: round(mae),
    rmseBp: round(Math.sqrt(mean((r) => r.errBp ** 2))),
    p999AbsBp: round(
      quantile(
        [...rs.map((r) => Math.abs(r.errBp))].sort((a, b) => a - b),
        0.999,
      ),
    ),
    naiveMaeBp: round(naiveMae),
    naiveRmseBp: round(Math.sqrt(mean((r) => r.naiveBp ** 2))),
    improvement: round(naiveMae === 0 ? 0 : 1 - mae / naiveMae, 4),
    bandCoverage: round(
      mean((r) => (r.inBand ? 1 : 0)),
      4,
    ),
    pitHistogram: hist,
  };
}

/** Standard normal CDF (Abramowitz–Stegun 7.1.26 erf, |error| < 1.5e-7). */
export function normCdf(x: number): number {
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-z * z);
  return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}
