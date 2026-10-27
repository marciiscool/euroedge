# ADR-0014 — Smart-wallet deposits

- **Status:** Accepted (founder, 2026-10-27)
- **Review gate:** math (contracts)

## Context
OpenZeppelin's `ERC20Permit` verifies with ECDSA only, so smart wallets (ERC-1271) cannot use the gasless permit deposit. Counterfactual (not yet deployed, EIP-6492) wallets cannot satisfy ERC-1271 on-chain at all. We own TestUSDC, so we can change its permit.

## Decision

**1. TestUSDC permit**
- `permit(owner, spender, value, deadline, bytes signature)` verifies the standard EIP-2612 typed data with OZ `SignatureChecker.isValidSignatureNow` (EOA via ECDSA, deployed smart wallets via ERC-1271).
- The standard `(v, r, s)` overload is kept for EOA compatibility.
- Nonces and the domain are the same as in ERC-2612.

**2. Relayed path** (EOA and deployed smart wallets)
- The relayer submits `claimFor(user, sig)` and `Vault.depositWithPermit(user, amount, deadline, sig)`.
- `claimFor` verifies its own typed data with `SignatureChecker` as well.

**3. Counterfactual wallets**
- Detection: `eth_getCode(user) == 0x` and a signature with the EIP-6492 magic suffix.
- The web app sends one **EIP-5792 `wallet_sendCalls`** batch: `claim()` (if needed) → `approve(vault, amount)` → `vault.deposit(amount)`.
- The batch uses the **ERC-7677 `paymasterService` capability**, pointing at the CDP Paymaster, which is restricted to calls on our TestUSDC and Vault contracts.
- The first batch also deploys the wallet.

**4. SIWE** for all wallet types is verified with viem `verifySiweMessage` (1271 + 6492), as in the brief.

## Consequences
- Foundry tests use an ERC-1271 mock wallet for permit and `claimFor`.
- Playwright uses the wagmi mock connector with a `wallet_sendCalls` stub.
- The CDP Paymaster needs an API key and an allowlist (M5-15).
