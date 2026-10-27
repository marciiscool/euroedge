# ADR-0013 — House & insurance genesis capital, CB7, Invariant 7

- **Status:** Accepted (founder, 2026-10-27; Invariant 7 interpretation confirmed, full form and CB7 hysteresis added at M0 review). Items still marked _proposed_ need founder review.
- **Review gate:** math

## Context

The house is the counterparty to every trade. Test USDC is non-transferable except faucet→user and user↔Vault. If the house balance went negative, users' withdrawable balances would exceed what the Vault holds.

## Decision

### Genesis

- At deploy, the admin mints Test USDC **straight into the Vault**:
  - **50,000,000** for the house;
  - **5,000,000** for the insurance fund.
- `TestUSDC.mintGenesis(vault, amount)` can be called once by the admin; it is the only minter→Vault path besides `claim`.
- `Vault.recordGenesis(house, insurance)` emits `GenesisFunded(houseAmount, insuranceAmount)`.
- The indexer turns that event (at the `safe` tag) into a `GenesisCapital` engine input event. Its ledger postings are `vault-inflow → house 50,000,000` and `vault-inflow → insurance 5,000,000`.
- The engine rejects every other deposit or credit until `GenesisCapital` has been applied. Ledger and Vault therefore reconcile from block 0.
- **Invariant 1 (restated):** Σ ledger balances = genesis + Σ deposits − Σ executed withdrawals, exactly.
- _Proposed:_ house/insurance top-ups use the same path (`mintGenesis`-style, logged, admin-only). Each top-up needs founder approval.

### CB7 — capital floor (with hysteresis)

- **Trigger:** global reduce-only when `houseEquity < 20 % × 50,000,000` (10,000,000) **or** `insuranceBalance < 20 % × 5,000,000` (1,000,000).
- **Release:** only once **both** are above 30 % of genesis (15,000,000 and 1,500,000), so CB7 does not flap in fast markets.
- `houseEquity` = house cash + house unrealized PnL at the latest mark event + accrued, unsettled funding.

### Invariant 7 — solvency (confirmed)

Checked with a runtime assert on **every event**:

`Σ_users max(0, equity_i) + max(0, houseEquity) + insuranceBalance ≤ vaultBalance`

- `houseEquity` = cash + unrealized PnL at the latest mark event (founder-confirmed interpretation).
- `vaultBalance` = the engine's view of Vault holdings (= Σ ledger balances, by Invariant 1).

### Invariants 8 and 9

Checked on every event as separate asserts:

- **Invariant 8:** `houseEquity ≥ 0`.
- **Invariant 9:** `insuranceBalance ≥ 0`.

_Proposed:_ on any violation the engine **fail-stops** (it stops applying events, raises an alert and serves read-only) rather than continuing on suspect state.

## Consequences

- Deploy scripts (M5-07) must run genesis before any user activity.
- Model and property tests cover both CB7 and Invariant 7.
