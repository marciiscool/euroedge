# EuroEdge methodology v1: fair value, index, mark and baskets

> Testnet, play money. On `sim`/`replay` data every price is simulated and labelled as such.

## 1. Why a fair value

European exchanges trade about 8.5 hours a day, but a perpetual trades around the clock. Outside exchange hours EuroEdge prices each market with a **fair value (FV)**, an estimate of where the primary listing would trade now. It combines live signals and states its own uncertainty.

## 2. Time windows

Each market's windows come from its venues' calendars (`config/calendars/`, holidays and half-days included):

| Window | Meaning                                            | Index                              |
| ------ | -------------------------------------------------- | ---------------------------------- |
| A      | Primary exchange in continuous trading             | median of {primary, Tradegate, FV} |
| B      | Tradegate open outside A (includes the US session) | FV                                 |
| C      | Weeknight                                          | FV (ADR overnight, else widening)  |
| D      | Weekends and holidays                              | FV_last with a widening band       |

Leverage, fees and funding caps tighten from A to D (`config/windows.yaml`).

## 3. Fair value

**Anchor `C`.** `C` is the official closing-auction price of the primary listing, converted to EUR at the time of the close:

- GBX are divided by 100 and converted at EURGBP.
- DKK are converted at EURDKK. Without a feed, the ERM II central rate of 7.46038 is used, and an alert is raised if EURDKK moves more than 0.5 % from it.
- On a local ex-dividend date, `C` drops by the gross dividend.

**Signals.** Each signal is a log return since the close:

- **Tradegate:** `s_T = ln(mid / C)`. It counts only if the spread is under 30 bp and the quote is under 60 s old.
- **US ADR, return form:**
  - `s_A = ln(ADR_t / ADR_C) − ln(EURUSD_t / EURUSD_C) − b_A`.
  - The ADR is put on the local line's dividend footing, because each line goes ex on its own date.
  - `b_A` is an exponentially weighted average of the ADR's past close-to-open errors.
  - An ADR whose ratio is not verified gets weight 0.

**Combination.**

- `v_k = σ_k² + λ · age_k`
- `w_k ∝ 1/v_k`
- `ŝ = Σ w_k s_k`
- `σ_FV = max(σ_floor, φ · (Σ 1/v_k)^(−1/2))`, where `φ ≥ 1` allows for signals sharing information.
- `FV = C · e^ŝ`, and the band is `FV · e^(±2.5 σ_FV)`.

With no live signal, FV stays at its last value and the uncertainty widens: `σ² += q[window] · hours`.

**Confidence** is high below 25 bp, medium below 75 bp, otherwise low; it is "none" before the first live signal.

## 4. Index and mark

**Index.** In Window A the index is the median of {primary, Tradegate, FV}. In all other windows it is the FV.

**Mark.** The mark follows the index at most 50 bp per second, then is clamped into the band. The band always wins (ADR-0009). A mark pinned to the band for more than 60 s degrades the market (CB8).

**Reopen snap.** At the official opening auction:

- FV, index and band move to the opening price, and the step cap is lifted for 60 s.
- An open outside the previous band makes the market reduce-only for 5 minutes.
- Indicative auction prints are never used.

## 5. Baskets

A basket level is

`level = L₀ · Σ wᵢ · FVᵢ / Bᵢ / Σ wᵢ`

where `L₀ = 1 000` and `Bᵢ` are the constituents' base prices. In the live tiers the base prices are fixed by a published rebalance event.

**Data gaps.** A constituent without data is dropped and the weights renormalized; the snapshot lists what was dropped. Below 50 % weight coverage no basket price is published.

**Uncertainty.** `σ_basket = sqrt(Σ wᵢ wⱼ ρᵢⱼ σᵢ σⱼ)`, with ρ estimated by an exponentially weighted covariance of one-minute FV returns. Until 30 samples exist, ρ = 1. Constituents are never assumed independent.

**Constituents (draft, subject to founder sign-off).**

- **EE-Blue 20:** the 20 largest eurozone shares by free float on Xetra, Euronext Amsterdam and Euronext Paris, with a 10 % cap and quarterly rebalancing.
- **EE-Semis:** five European semiconductor shares with a 35 % cap.

## 6. Circuit breakers

| #      | Trigger                                                            | Effect                              |
| ------ | ------------------------------------------------------------------ | ----------------------------------- |
| CB1    | ADR- and Tradegate-implied prices differ by > 3σ for 60 s          | no new positions                    |
| CB2    | primary halt (feed silent > 60 s in continuous trading)            | reduce-only                         |
| CB3    | index stale > 15 s (A) / 120 s (B–D) while a source should be live | no new positions, double spread     |
| CB3-TG | Tradegate stale > 5 min while open; released after 2 min fresh     | reduce-only                         |
| CB4    | EE-Blue 20 −7 % vs its close                                       | every market reduce-only for 15 min |
| CB8    | mark pinned to the band > 60 s                                     | no new positions, double spread     |
| SNAP   | open outside the previous band                                     | reduce-only for 5 min               |

Breakers are evaluated each second on event time, logged with the market data the engine consumes, and shown in the terminal.

## 7. House quotes

The house is the counterparty to every trade. It quotes around FV and never moves FV, index or mark with its own flow.

- The half-spread widens with model uncertainty (σ_FV) and is wider in the off-hours windows.
- It leans against the house's own inventory. When the house is long, buying gets slightly cheaper and selling slightly dearer.
- Larger orders pay a convex size impact. The quote ladder shows the executable price for €1k, €5k, €25k and €100k, from the same calculation that fills.
- Prices are rounded to the tick in the house's favour.

## 7a. Dividends

On a dividend's local ex-date the fair value drops by the dividend (§3), and the engine moves cash so that holders are treated like holders of the share:

- **Longs receive the dividend net of withholding tax.** The withholding rate is configured per market; the proposed default is 15 %.
- **Shorts pay the full (gross) dividend.**
- The house is the other side of every payment; the withheld part stays with the house.

**Example.** A dividend of €1.50 per share with 15 % withholding:

- 10 shares long receive 10 × 1.50 × 0.85 = **12.75**.
- 5 shares short pay 5 × 1.50 = **7.50**.

Amounts longs receive are rounded down to the smallest unit.

## 8. Accuracy

The backtest (`docs/backtest/`) replays recorded or simulated ticks through the same code. It scores the FV against the next official open:

- MAE and RMSE;
- the improvement over the last close;
- band coverage;
- the PIT histogram.

Public accuracy figures are published only from real `live-min` data.

## 9. Worked examples

`docs/methodology/examples/` holds hand-derived examples (fees, liquidation price, FV, house quote) that CI checks against the production code.
