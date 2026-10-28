import { WINDOWS, type FvParams, type Window } from '@euroedge/shared';
import type { ScoredSample } from './run.ts';

export interface WindowFit {
  readonly currentFloorBp: number;
  readonly recommendedFloorBp: number;
  readonly trainN: number;
  readonly testN: number;
  /** Out-of-sample band coverage with the current and the recommended floor. */
  readonly testCoverageCurrent: number;
  readonly testCoverageRecommended: number;
}

export interface FitResult {
  readonly method: string;
  readonly targetCoverage: number;
  /** Samples before this time train the fit; later ones test it (walk-forward, no look-ahead). */
  readonly splitTs: number;
  readonly sigmaFloorBp: Readonly<Record<Window, WindowFit>>;
}

const coverage = (xs: readonly ScoredSample[], k: number, floorBp: number) =>
  xs.length === 0
    ? 0
    : Math.round(
        (xs.filter((x) => Math.abs(x.errBp) <= k * Math.max(x.sigmaBp, floorBp)).length /
          xs.length) *
          1e4,
      ) / 1e4;

function quantile(xs: readonly number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))] ?? 0;
}

/**
 * M3-16 (first step): per-window σ floors so the FV band covers the next open at the target rate.
 * Trained on the first half of the samples, tested on the second. A proposal for founder review,
 * never applied automatically; λ, φ, q and the basis half-life follow once live-min data exists.
 */
export function fitSigmaFloors(
  samples: readonly ScoredSample[],
  params: FvParams,
  target = 0.985,
): FitResult {
  const ts = samples.map((s) => s.ts).sort((a, b) => a - b);
  const splitTs = ts[Math.floor(ts.length / 2)] ?? 0;
  const k = params.bandSigmas;
  const fits = Object.fromEntries(
    WINDOWS.map((w) => {
      const train = samples.filter((s) => s.window === w && s.ts < splitTs);
      const test = samples.filter((s) => s.window === w && s.ts >= splitTs);
      const current = params.sigmaFloorBp[w];
      const needed =
        train.length === 0
          ? current
          : Math.ceil(
              quantile(
                train.map((s) => Math.abs(s.errBp)),
                target,
              ) / k,
            );
      const recommended = Math.max(current, needed);
      return [
        w,
        {
          currentFloorBp: current,
          recommendedFloorBp: recommended,
          trainN: train.length,
          testN: test.length,
          testCoverageCurrent: coverage(test, k, current),
          testCoverageRecommended: coverage(test, k, recommended),
        },
      ];
    }),
  ) as Record<Window, WindowFit>;
  return {
    method: 'walk-forward 50/50, quantile of |error| / bandSigmas',
    targetCoverage: target,
    splitTs,
    sigmaFloorBp: fits,
  };
}
