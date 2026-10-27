# ADR-0003 — Quote / impact model

- **Status:** Accepted (founder, 2026-10-27)
- **Review gate:** math

## Context

The house is the only counterparty (brief §7.1). Its quotes must:

- be size-aware;
- widen with σ_FV;
- skew with inventory;
- resist manipulation (a whale must not be able to move the mark or liquidate others).

The ladder in the UI must match what actually fills.

## Decision

Every term below is computed in fixed point inside `risk-core`. Parameters are per market and per window in `windows.yaml`.

**1. Marginal price for EUR notional `x`** (side sign `± = +1` buy, `−1` sell):
`p(x) = FV · (1 ± (h + γ · (x / x_ref)^α))`, with `α ∈ [1.5, 2]` (convex impact).

**2. Fill price for size `q`.** It is the notional-weighted average of `p` over `[0, q]`:
`FV · (1 ± (h + γ/(α+1) · (q / x_ref)^α))`.
In code it is evaluated with an integer power and lookup, so no floats.

**3. Half-spread:**
`h = h_base[window] + a · σ_FV + s · clamp(inv / invCap, −1, 1) · side`.
The skew widens the side that adds to house inventory and tightens the side that reduces it.

**4. Flow shift:** `shift = clamp(κ · netFlow, ±0.5 h)`.

- `netFlow` is an EWMA over event time.
- Each wallet's contribution is capped per window of event time.
- The shift moves **quotes only**. It never moves FV, index or mark.

**5. Rounding.** Bid rounds down to tick, ask rounds up (house-favourable).

**6. Price limit.** A fill outside `index ± priceLimit[window]` is rejected for market/IOC/FOK orders; a GTC limit order rests instead.

**7. Inventory limits.** Past `invCap` the house quotes one side only. Past `invHardCap` the market is reduce-only.

**8. Ladder.** The ladder (€1k / €5k / €25k / €100k) is computed with the **same function** that fills.

**9. Resting limits.**

- A resting limit fills **at its limit price** when the executable price for its **full size** crosses it, and pays the maker fee.
- No partial fills for resting orders in v1. This is a proposal (R17) pending founder confirmation.

## Consequences

- Calibration uses the informed-arbitrageur bot: spreads must keep the toxic-flow cost per €1M OI within budget.
- In step 3, the same model becomes the real market maker (plus hedging cost terms). In step 2, it is replaced by the partner's book behind `ExecutionAdapter`.
