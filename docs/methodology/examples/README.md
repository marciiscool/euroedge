# Golden test vectors

Hand-checkable examples for the money and model maths (brief §6.6). CI runs every file against the production code:

- funding: `apps/engine/test/funding.test.ts`;
- fees and liquidation price: `packages/risk-core/src/golden.test.ts`;
- FV: `packages/fv-core/src/golden.test.ts`.

| File                     | What                                        | Status                           |
| ------------------------ | ------------------------------------------- | -------------------------------- |
| `fees.json`              | Taker fee rounding (ceil)                   | awaiting the founder spreadsheet |
| `liquidation-price.json` | Liquidation price, long/short, stock/basket | awaiting the founder spreadsheet |
| `fair-value.json`        | Signal combination, σ floor, band           | awaiting the founder spreadsheet |
| `funding.json`           | Funding rate with the cap on the total      | pending (M4)                     |

Every case has a `working` line with the arithmetic, so it can be re-done by hand. When the founder's spreadsheet disagrees, the vector changes only through a reviewed PR (label `needs-founder-review`).
