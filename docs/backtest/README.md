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
