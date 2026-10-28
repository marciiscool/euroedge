# ADR-0018 — Funding settlement: rounding, OI cap, accrual

- **Status:** Proposed (needs founder review)
- **Date:** 2026-10-28
- **Deciders:** founder, lead engineer
- **Review gate:** math

## Context

ADR-0016 fixes the funding rate. Implementing it (M4-10) left three gaps.

1. **Rounding.** ADR-0016 says `payment_i = position_i × ΔfundingIndex`, rounded toward zero, residue to `fees`. Rounding payers and receivers toward zero makes the residue **negative** whenever receivers lose less to truncation than payers. Example: longs 1 + 1 lot owe 0.5 µUSDC each and a short of 2 lots is owed 1.0. Toward zero, that is 0 + 0 paid against 1 received, so −1. `fees` then funds the gap. With `fees` near zero, that breaks Invariant 7, and the founder requires every invariant to hold after every event.
2. **OIcap_w.** The skew term `cap_w × clamp(netOIskew / OIcap_w, −1, 1)` needs `OIcap_w`. No document defines it. M4-08 (OI caps) has not been built yet.
3. **Accrual mechanics.** ADR-0016 says "per second, settled hourly", but positions change within the hour.

## Options

Rounding:

1. **Everyone toward zero (ADR-0016 text).** The residue can be negative, and `fees` can go negative.
2. **Payers round up, receivers toward zero.** The residue is always ≥ 0 and below 1 µUSDC per holder. This is house-favourable, like fees (ceil) and quotes.

OIcap:

1. Hard-code a value.
2. **Config per window in `windows.yaml`** (`fundingOiCapUsdc`, whole USDC, per market), with proposed values. M4-08 can later move it per market.

## Decision (proposed)

- **Rounding: option 2.**
  - `payment = ceil(owed)` when the holder pays, `−trunc(|owed|)` when it receives.
  - The residue `Σ payments ≥ 0` goes to `fees` in the same ledger batch, through `funding-clearing`, which ends at 0 after every event.
- **OIcap: option 2.**
  - Proposed values: A 2,000,000, B 1,000,000, C 500,000 USDC; D `null`, so there is no skew term.
  - `null` for a window means no skew term.
  - A `null` funding cap means interest only and no clamp (Window D, as in ADR-0016).
- **Rate.**
  - `rate_h = clamp(interest_h + skew_h + quantoDrift, ±cap_w)` in `Rate` (1e-18) per hour.
  - `interest_h = trunc(bps p.a. × 1e18 / (1e4 × 8760))`, which is 5,707,762,557,077 for 5 %.
  - `skew_h` is truncated toward zero.
  - `netOIskew = −houseLots × mark × tickValue`.
- **Accrual.**
  - A per-market index grows by `mark × tickValue × rate_h × Δms` on every event, exactly (µUSDC·Rate·ms per lot). It uses the mark and rate in force since the previous event. Accrual is therefore per millisecond of event time, which refines ADR-0016's per-second accrual.
  - Before any change to a holder's lots (fill, liquidation, and the house mirror), the holder's owed amount is rolled into an exact `pending`.
- **Settlement.**
  - Every holder settles at each UTC hour boundary, including the house. Hours with no event are settled at the next event, accruing exactly to each boundary.
  - Unsettled funding is **not** in equity until it settles. That is at most one hour at ≤ the cap.
  - **Negative-balance protection:** a user pays at most `max(0, equity)`. Insurance covers the rest, as for liquidations. Liquidation runs after settlement.
- **Invariant 3** (checked on every event):
  - Σ exact owed over all holders = 0 per market.
  - `funding-clearing` = 0.

## Consequences

- Golden vectors: `docs/methodology/examples/funding.json`, checked in `packages/risk-core/src/golden.test.ts`.
- `MarketListed` is v2. v1 logs upcast with funding off and maker fee = taker fee.
- If the founder prefers option 1 for rounding, a deficit needs a funding source other than `fees` (house or insurance), plus an Invariant 7 margin.
