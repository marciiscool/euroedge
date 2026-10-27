/**
 * EWMA covariance of constituent log returns (M3-11). Until `minSamples` returns have been seen,
 * correlations are taken as 1: a conservative basket σ, never an independence assumption.
 */
export class EwmaCovariance {
  private readonly n: number;
  private readonly lambda: number;
  private readonly minSamples: number;
  private readonly cov: Float64Array;
  private samples = 0;

  constructor(n: number, lambda = 0.97, minSamples = 30) {
    this.n = n;
    this.lambda = lambda;
    this.minSamples = minSamples;
    this.cov = new Float64Array(n * n);
  }

  /** Adds one vector of log returns; NaN entries (missing constituents) are skipped pairwise. */
  update(r: readonly number[]): void {
    const { n, lambda } = this;
    for (let i = 0; i < n; i++)
      for (let j = i; j < n; j++) {
        const ri = r[i] ?? NaN;
        const rj = r[j] ?? NaN;
        if (Number.isNaN(ri) || Number.isNaN(rj)) continue;
        const v = lambda * (this.cov[i * n + j] ?? 0) + (1 - lambda) * ri * rj;
        this.cov[i * n + j] = v;
        this.cov[j * n + i] = v;
      }
    this.samples++;
  }

  get warmedUp(): boolean {
    return this.samples >= this.minSamples;
  }

  correlation(i: number, j: number): number {
    if (i === j || !this.warmedUp) return 1;
    const n = this.n;
    const d = Math.sqrt((this.cov[i * n + i] ?? 0) * (this.cov[j * n + j] ?? 0));
    if (d === 0) return 1;
    return Math.max(-1, Math.min(1, (this.cov[i * n + j] ?? 0) / d));
  }

  /** σ of a portfolio with weights w over members with σ_i (log units): sqrt(Σ w_i w_j ρ_ij σ_i σ_j). */
  portfolioSigma(w: readonly number[], sigma: readonly number[]): number {
    let v = 0;
    for (let i = 0; i < this.n; i++)
      for (let j = 0; j < this.n; j++)
        v += (w[i] ?? 0) * (w[j] ?? 0) * this.correlation(i, j) * (sigma[i] ?? 0) * (sigma[j] ?? 0);
    return Math.sqrt(Math.max(v, 0));
  }
}
