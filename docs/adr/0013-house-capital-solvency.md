# ADR-0013 — House & insurance genesis capital, CB7, Invariant 7

- **Status:** Accepted (founder, 2026-10-27). Items marked *proposed* still need founder review.
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
- *Proposed:* house/insurance top-ups use the same path (`mintGenesis`-style, logged, admin-only). Each top-up needs founder approval.

### CB7 — capital floor
Global reduce-only while either holds:
- `houseEquity < 20 % × 50,000,000` (10,000,000), or
- `insuranceBalance < 20 % × 5,000,000` (1,000,000).

`houseEquity` = house cash + house unrealized PnL at the current mark + accrued, unsettled funding.

*Proposed:* CB7 clears only by an admin event, after recapitalisation.

### Invariant 7 — solvency
Checked on **every event** with a runtime assert:

`Σ_users withdrawable_i ≤ vaultBalance − houseEquity − insuranceBalance`

where:
- `withdrawable_i = max(0, equity_i − IM_i)`, the amount the user could withdraw now;
- `vaultBalance` = the engine's view of Vault holdings (equal to Σ ledger balances, by Invariant 1).

*Interpretation pending founder confirmation.* "House" means **house equity** (cash + unrealized PnL), not house cash.
- With house cash, the check fails whenever users are in profit: their withdrawable balance includes unrealized gains, while the house's offsetting loss is not yet realised.
- With house equity, the right-hand side equals `Σ_users equity + fees + funding-clearing + vault-pending`. The check then catches broken equity maths and negative clearing accounts.

*Proposed:* on a violation the engine **fail-stops** (it stops applying events, raises an alert and serves read-only) rather than continuing on suspect state.

## Consequences
- Deploy scripts (M5-07) must run genesis before any user activity.
- Model and property tests cover both CB7 and Invariant 7.
