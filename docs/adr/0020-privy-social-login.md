# ADR-0020 — Social login with Privy embedded wallets

- **Status:** Accepted (founder, 2026-10-28)
- **Date:** 2026-10-28
- **Deciders:** founder, lead engineer
- **Review gate:** none
- **Supersedes:** the RainbowKit part of [ADR-0006](0006-wagmi-2.md). wagmi 2 + viem 2 stay.

## Context

The founder wants login and wallet to work like Hyperliquid's. A user signs in with an email code or Google and gets a self-custodial wallet without installing anything. Users with MetaMask, Rabby and similar wallets connect as before. Hyperliquid does this with Privy embedded wallets.

The plan had RainbowKit (wallets only, ADR-0006) plus our own SIWE session (M6-01, M7-24).

## Options

1. **Privy** — what Hyperliquid uses. Email, Google and external wallets come in one modal. Embedded wallets are EOAs the user can export. It has a wagmi 2 adapter. Its pricing page lists a free plan for up to 1,000 MAU. The provider is US-based (Stripe).
2. **Coinbase CDP embedded wallets** — fit the CDP Paymaster we already plan to use (ADR-0014), but the flow is less like Hyperliquid's.
3. **Dynamic** — comparable, but it would be a second vendor account.

## Decision

**Provider and sign-in window (founder)**

- **Privy** (`@privy-io/react-auth` 3, `@privy-io/wagmi` 4) replaces RainbowKit.
- One sign-in window offers **email code, Google and external wallets**.
- Users without a wallet get an embedded Ethereum wallet on first login.

**Our server never trusts Privy for identity.** The session is still our own SIWE (M6-01):

- `GET /api/auth/nonce` returns a single-use nonce, stored in Valkey with a 5-minute TTL.
- `POST /api/auth/siwe {message, signature}`:
  - checks that domain and URI match `PUBLIC_ORIGIN`, that `chainId` is `CHAIN_ID`, and that `issuedAt` is no more than 5 minutes old;
  - consumes the nonce;
  - verifies the signature: with viem `verifySiweMessage` against `BASE_SEPOLIA_RPC_URL` when that is set (EOA, ERC-1271, ERC-6492, as in ADR-0014), otherwise ECDSA only (EOA; local and CI);
  - sets the signed session cookie. The account id is the lower-case address.
- `POST /api/auth/logout` clears the cookie.

**Embedded wallets sign the SIWE message without a confirmation dialog.** For email and Google users, signing in is therefore one step, as on Hyperliquid.

**External wallets: two signatures.** They sign twice: once for Privy's own wallet login and once for our SIWE. This is accepted for now. The alternative is to verify Privy identity tokens server-side, which would make Privy part of our trust base.

**Play money until on-chain deposits exist (M5).** A wallet account gets the same one-time `DEV_FAUCET_USDC` credit as a dev account, only while `DATA_TIER=sim`.

**Configuration:**

- `NEXT_PUBLIC_PRIVY_APP_ID`. Without it the sign-in button is hidden and only the dev login (if enabled) shows.
- All wallet code lives in `apps/web/src/wallet/*` and is loaded lazily, only on the trade page, to protect the shell budget (M7-28).

## Consequences

**Founder tasks before a public deploy:**

- create the Privy app;
- enable email and Google;
- set the allowed origins;
- sign Privy's DPA and name Privy in the privacy notice: it processes email addresses and Google identities, so GDPR applies.

**Wallet flow, deposits and tests:**

- Embedded wallets are EOAs, so they take the relayed permit deposit path of ADR-0014 (no paymaster needed).
- Users can export their key from Privy and move to a wallet extension, as on Hyperliquid.
- e2e keeps the dev login and the wagmi `mock` connector (M7-29). Privy itself is not exercised in CI because that would need a live app id.
- The wallet SDKs pull old transitive packages: `ws` is overridden to 8.22, and the zod-3 advisory GHSA-mrhx-c7xc-m3w5 inside WalletConnect/Reown is an accepted, documented exception (browser-only; `pnpm-workspace.yaml`), as is GHSA-qr28-fpjm-wq7f in `decode-uri-component` 0.2.2 (its only fix is ESM-only and breaks `query-string` 7).
- M7-24 now reads "Privy sign-in + SIWE + network switch".
