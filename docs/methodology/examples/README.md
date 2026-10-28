# Golden test vectors

Hand-checkable examples for the money and model maths (brief §6.6). CI runs every file against the production code:

- fees, liquidation price and funding: `packages/risk-core/src/golden.test.ts`;
- FV: `packages/fv-core/src/golden.test.ts`.

| File                     | What                                        | Status                           |
| ------------------------ | ------------------------------------------- | -------------------------------- |
| `fees.json`              | Taker fee rounding (ceil)                   | awaiting the founder spreadsheet |
| `liquidation-price.json` | Liquidation price, long/short, stock/basket | awaiting the founder spreadsheet |
| `fair-value.json`        | Signal combination, σ floor, band           | awaiting the founder spreadsheet |
| `funding.json`           | Funding rate (cap on the total), settlement | awaiting the founder spreadsheet |

Every case has a `working` line with the arithmetic, so it can be re-done by hand. When the founder's spreadsheet disagrees, the vector changes only through a reviewed PR (label `needs-founder-review`).
