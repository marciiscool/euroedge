# Backtest

```
pnpm --filter @euroedge/backtest start -- --data data/sample --out docs/backtest/sample-report.json
```

How it works:

- The backtest replays tick files through the **production** `fv-core` pipeline (brief §6.6, no duplicated maths).
- It samples FV every 15 minutes of event time.
- It scores every sample against the next official open (the primary opening-auction print), and against the naive "last close".
- A sample taken before an ex-dividend date is compared net of the dividend.
- The report schema is `reportSchema` in `apps/backtest/src/metrics.ts`.

## Sample result (`sample-report.json`, simulated data, seed parameters)

| Market | MAE bp | Naive MAE bp | Improvement | Band coverage |
| ------ | -----: | -----------: | ----------: | ------------: |
| ASML   |   84.7 |        107.7 |       +21 % |          73 % |
| SAP    |   68.2 |         95.1 |       +28 % |          76 % |
| NOVO   |  114.1 |        141.8 |       +20 % |          70 % |
| SHEL   |   72.1 |         83.1 |       +13 % |          76 % |
| TTE    |  108.4 |        111.1 |        +2 % |          73 % |

**Reading it:**

- FV beats the last close in every market.
- The band covers only about 73 % of opens, against a 98–99.5 % target. The seed σ describes "now", not the horizon to the next open.
- Fitting σ, λ, φ and q to this report is M3-16. Until then the seed parameters stay, and that is flagged for founder review.
- These are simulated prices. Real accuracy comes from `live-min` recordings (LR track).

## σ-floor fit (M3-16, `sigma-floor-fit.json`)

```
pnpm --filter @euroedge/backtest start -- --data data/sample --fit --out docs/backtest/sigma-floor-fit.json
```

Method: walk-forward. The first half of the samples trains a per-window floor, set to the 98.5 % quantile of |error| divided by `bandSigmas`. The second half tests it.

| Window | Current floor | Recommended | Out-of-sample coverage: now → recommended |
| ------ | ------------: | ----------: | ----------------------------------------: |
| A      |          5 bp |       98 bp |                               20 % → 95 % |
| B      |         10 bp |       79 bp |                               43 % → 98 % |
| C      |         20 bp |       84 bp |                              87 % → 100 % |
| D      |         30 bp |       78 bp |                               97 % → 98 % |

**Not applied: founder decision needed.**

- **B/C/D.** The recommendation follows the brief's coverage target directly.
- **A.** Scoring a live-session band against the next day's open asks it to cover an overnight horizon. A ±2.5 % band in Window A would stop the band clamp from protecting the mark.
- **Proposal.** Keep the A floor small and measure A coverage against the official close instead. Alternatively, add a horizon term `q · hours-to-next-open` to the band in B/C/D only.
- The final fit (σ_k, λ, φ, q, basis half-life) waits for real `live-min` recordings. Fitting on simulated data mostly recovers the simulator's own parameters.
