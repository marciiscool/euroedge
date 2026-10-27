# ADR-0002 — Fixed-point library

- **Status:** Accepted (founder, 2026-10-27)
- **Review gate:** math

## Context
Brief §7.1 rules: no floats in the engine; USDC in 1e6 units; integer price ticks; lots; fees round up; PnL rounds toward zero with the residue going to fees.

## Options
1. **Own thin wrapper over native `bigint`** (`packages/fixed`) — zero dependencies, explicit rounding, ~300 LOC we control.
2. **decimal.js / big.js** — decimal floating semantics; precision is implicit global state; slower.
3. **dnum** — reasonable, but adds little over option 1.

## Decision
Option 1.
- **Branded types:**
  - `Usdc` (µUSDC, 1e-6)
  - `Ticks` (per-market integer price)
  - `Lots` (per-market integer quantity)
  - `Bps` (1e-4)
  - `Ppm` (1e-6)
  - `Rate` (1e-18; funding indices)
- **Rounding modes** are explicit at every call site: `floor | ceil | trunc | away | halfEven`. `mulDiv(a, b, d, mode)` and `divRound(n, d, mode)` are exact.
- **Integer tick value.** Each market defines `tickSize` (EUR) and `lotSize` (shares/units). The config loader **rejects** markets whose `tickValue = tickSize × lotSize × 1e6` is not an integer number of µUSDC.
  - Example: €0.01 × 0.01 share = 100 µUSDC.
  - With the quanto rule (1 EUR-pt = 1 USDC per contract), `PnL = Δticks × lots × tickValue` is then **exact**; no rounding is needed for PnL.
- **Rounding happens only in fees and funding.** Fees use `ceil`. Funding and other pro-rata amounts use `trunc`, and the residue is posted to the `fees` account.
- **Serialisation:** decimal strings only, never JSON numbers.

## Consequences
- Configs must choose compatible tick and lot sizes. Validation enforces this at load time.
- The UI converts to display numbers only at the edge, with `formatDecimal`.
