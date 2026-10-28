# ADR-0019 — Quote model, flow shift and house risk: implementation and proposed parameters

- **Status:** Proposed (needs founder review; every value below is a proposal)
- **Date:** 2026-10-28
- **Deciders:** founder, lead engineer
- **Review gate:** math

## Context

ADR-0003 fixes the shape of the house quote and its inventory limits, but no document sets the numbers: `a`, `s`, `γ`, `α`, `x_ref`, `κ`, the EWMA horizon, the per-wallet cap, `invCap`, `invHardCap` and the daily loss limit. PLAN M4-02, M4-03 and M4-14 need them. The founder asked for the build with clearly marked proposals.

## Decision (proposed)

### Integer maths (M4-02)

All spread terms are in ppm of FV and round up (house-favourable). The ask rounds up to the tick, the bid down, and the bid never goes below 0.

- `h = h_base + ⌈σ_FV · a⌉`.
- `skew = ⌈s · clamp(inv / invCap, −1, 1) · (−side)⌉`, with `inv` = house position at FV.
- The side offset is `m · max(0, h + skew)` with `m = 2` while degraded. The skew never quotes through FV.
- `impact = γ/(α+1) · (q/x_ref)^α`, where `q` is the order's notional at FV.
  - `α = 2` is exact.
  - `α = 1.5` uses `⌈√(q³ · 10¹⁸ / x_ref³)⌉ / 10⁹`.
  - Other `α` values would need an n-th root; v1 supports only these two.
- `price = FV · (1 ± (offset + impact) + shift)`, with `shift` clamped to `±m·h/2`.
- The ladder (€1k / €5k / €25k / €100k) calls the same function that fills.
- Logs from before M4 decode with every new term at 0, i.e. exactly the M1 quote. A property test pins this.

### Proposed quote values (`windows.yaml`)

|                          |       A |       B |       C |       D |
| ------------------------ | ------: | ------: | ------: | ------: |
| `h_base` (unchanged)     |    5 bp |   10 bp |   20 bp |   35 bp |
| `a` (`sigmaSpreadBps`)   |    10 % |    25 % |    25 % |    25 % |
| `s` (`inventorySkewBps`) |    3 bp |    5 bp |   10 bp |   15 bp |
| `invCap` (USDC)          |     2 M |     1 M |   0.5 M |   0.5 M |
| `γ` (`impactBps`)        |    5 bp |   10 bp |   20 bp |   30 bp |
| `x_ref` (USDC)           | 100 000 | 100 000 | 100 000 | 100 000 |
| `α`                      |     1.5 |     1.5 |     1.5 |     1.5 |

What these values mean in practice:

- A 1-share ASML order in Window A pays about `h + 1 ppm`.
- An order of `x_ref` pays an extra `γ/2.5` (2 bp in A).
- `invCap` equals the funding `OIcap` (ADR-0018), so the skew and the funding skew saturate together.

### Flow shift (M4-03)

- `netFlow` is an EWMA of signed user notional (buy +, sell −) over event time.
  - Per whole second it decays by the factor `1 − 1/τ`, raised to Δs with fixed-point square-and-multiply. Leftover milliseconds carry to the next event.
- Each wallet adds at most `walletCap` of absolute notional per `walletWindow` of event time. Anything beyond that does not count.
- Liquidations are not flow.
- The shift is `clamp(κ · netFlow, ±m·h/2)`. It moves **quotes only**, never FV, index or mark.

Proposed values (same in all windows): `κ` 100 ppm per 1,000,000 USDC of net flow, `τ` 300 s, `walletCap` 250,000 USDC per 60 s.

### House risk (M4-14)

- **One-sided:** once `|inv| ≥ invCap`, the house stops quoting the side that would grow its inventory. Such orders are rejected with `house-one-sided`, unless they reduce the user's own position.
- **Hard cap:** once `|inv| ≥ invHardCap`, the market is reduce-only for new exposure (`house-inventory`).
  - Proposed `invHardCap = 2 × invCap`: 4 M, 2 M, 1 M and 1 M USDC.
- **Daily loss limit:**
  - The house's loss since the start of the UTC day is equity at day start minus current equity, where equity = cash + uPnL.
  - If the loss exceeds the limit, the whole engine is reduce-only until the next UTC day.
  - Proposed limit: 2,500,000 USDC (5 % of house genesis). `null` disables it.
  - It is evaluated after every event, like CB7.

## Consequences

- Golden vectors: `docs/methodology/examples/quote.json`.
- Engine tests pin hand-computed fill prices.
- `MarketListed` v3 carries the quote, flow and inventory terms. A `HouseRiskParams` input carries the daily loss limit.
- Calibration against the informed-arbitrageur bot (M4-25) will move these values. Every change goes through review.
