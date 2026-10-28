# ADR-0016 — Risk parameter defaults (funding, liquidation penalty, contract granularity)

- **Status:** Accepted (founder, 2026-10-27; funding-cap interpretation confirmed at M0 review).
- **Review gate:** math

All values live in `config/windows.yaml` / `config/markets.yaml` and change only via `ParamChange` engine events.

## Contract granularity

|                      | Stocks                                | Baskets                           |
| -------------------- | ------------------------------------- | --------------------------------- |
| Lot size             | 0.01 share                            | 0.001 unit                        |
| Default tick         | €0.01                                 | 0.01 index pt                     |
| tickValue (ADR-0002) | 0.01 × 0.01 × 1e6 = **100 µUSDC**     | 0.01 × 0.001 × 1e6 = **10 µUSDC** |
| Min notional         | €10 (= 10 USDC under the quanto rule) | €10                               |

1 contract = 1 share, or 1 basket unit.

## Liquidation penalty

- **1 %** of liquidated notional at mark for stocks; **0.5 %** for baskets.
- **100 %** goes to the insurance fund. The house fills the liquidation at mark.
- The penalty is capped at the account's remaining equity (negative-balance protection). Any shortfall is drawn from insurance.

## Margin (unchanged from the brief)

- Maintenance margin is constant across windows: stocks 10 %, baskets 5 %.
- Max leverage on new exposure follows brief §7.2.

## Funding

- **Interest component:** 5 % p.a., **longs pay shorts**.
  - Accrued per second of event time: `r_s = 0.05 / (365 × 86,400)` in `Rate` (1e-18).
  - Settled hourly. Hourly equivalent ≈ 0.000571 %.
- **Skew component:** linear, `skew_h = cap_w × clamp(netOIskew / OIcap_w, −1, 1)`. This reaches exactly the window cap at |netOIskew| = OIcap.
  - `cap_w`: A 0.03 %, B 0.02 %, C 0.01 %.
  - A positive skew (net user long) means longs pay.
  - `netOIskew` = user long notional − user short notional at mark.
- **Window D:** interest only (no skew term).
- **Total hourly rate** (confirmed): `clamp(interest_h + skew_h, ±cap_w)` — the cap applies to the sum, after summing. Window D: interest only, no skew term and no skew cap.
- **Settlement:** zero-sum across longs, shorts and the house.
  - `payment_i = position_i × ΔfundingIndex`, rounded toward zero.
  - The rounding residue goes to `fees`.
- `quantoDrift` is stored and is 0 in v1.

## Consequences

- Golden vectors (M3-17) pin these numbers once the founder's spreadsheet is available.
- Settlement rounding, `OIcap_w` and accrual mechanics are proposed in ADR-0018 (pending review).
