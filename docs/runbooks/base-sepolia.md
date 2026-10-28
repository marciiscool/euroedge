# Runbook — Base Sepolia go-live (M5-14)

Deploy the contracts to Base Sepolia, switch the stack to the chain and try the whole flow: sign in → claim → deposit → trade → withdraw.

**Never paste a private key into a chat, an issue or a commit.** Keys live only in `.env` (git-ignored).

---

## 1. Keys (four, all different)

Create them with Foundry (`cast wallet new`) or any wallet you trust. Put each private key in `.env`:

| `.env`                      | Role                                                 | Needs ETH |
| --------------------------- | ---------------------------------------------------- | --------- |
| `DEPLOYER_PRIVATE_KEY`      | Deploys; loses every role at the end                 | yes       |
| `ENGINE_SIGNER_PRIVATE_KEY` | Signs withdrawals (`apps/signer`)                    | no        |
| `ROOT_POSTER_PRIVATE_KEY`   | Posts hourly balance roots                           | yes       |
| `RELAYER_PRIVATE_KEY`       | Pays gas for users' claims, deposits and withdrawals | yes       |

Fund the three ETH roles with Base Sepolia ETH. 0.05 ETH each is plenty to start; the relayer warns below `RELAYER_MIN_ETH`. Use a Base Sepolia faucet; Coinbase's developer platform and the large RPC providers run free ones.

## 2. Services

1. **RPC.** Create a Base Sepolia endpoint with an RPC provider and set `BASE_SEPOLIA_RPC_URL`. The public `https://sepolia.base.org` works for a first try but is rate-limited.
2. **Safe.** At app.safe.global, choose network **Base Sepolia** and create a Safe (2-of-3 recommended). Set `ADMIN_SAFE` to its address. It becomes the admin of all contracts and can pause the Vault.
3. **Basescan.** Create an Etherscan API key; one v2 key covers Basescan. Set `ETHERSCAN_API_KEY`.
4. **Privy** (dashboard.privy.io): create an app.
   - Login methods: Email, Google, Wallet.
   - Embedded wallets: Ethereum, created on login for users without a wallet.
   - Allowed origins: `http://localhost:8080`.
   - Set `NEXT_PUBLIC_PRIVY_APP_ID` to the app id.

## Lean trial (fewest steps)

For a first trial, two things are enough: Base Sepolia ETH on the **deployer** address only, and the Privy app id.

- **Safe and Etherscan key are optional.** Without `ADMIN_SAFE`, the deployer key stays admin; hand over to a Safe later. Without `ETHERSCAN_API_KEY`, the contracts deploy unverified on Basescan.
- **0.0003 ETH is enough to deploy.** At testnet gas prices the whole deploy costs about 0.0001 ETH. Coinbase's developer faucet (CDP portal) pays 0.0001 ETH per claim with no mainnet balance required; claim a few times. Alchemy's faucet requires 0.001 ETH on Ethereum mainnet.
- **One funded address.** After funding the deployer, `pnpm chain:fund` passes 0.0001 ETH each to the relayer and the root poster.

## 3. Preflight

```bash
pnpm chain:check
```

It prints the address behind each key, their ETH balances and what is missing. It never prints a key. Fix every ✗ before deploying.

## 4. Deploy

Needs Foundry's `forge` and `cast`, either on your PATH or via `FOUNDRY_BIN=/path/to/foundry/bin`.

```bash
scripts/deploy-base-sepolia.sh
```

The script:

1. deploys TestUSDC, Vault and BalanceRoot;
2. runs genesis: 50 000 000 house + 5 000 000 insurance into the Vault;
3. hands admin and pauser roles to your Safe and renounces the deployer's;
4. verifies the sources on Basescan;
5. writes `contracts/deployments/84532.json`. **Commit that file.**

Details and emergency steps: `docs/runbooks/contracts-deploy.md`.

## 5. Switch the stack to the chain

Copy the values from `contracts/deployments/84532.json` into `.env`:

```bash
TOKEN_ADDRESS=<testUsdc>
VAULT_ADDRESS=<vault>
BALANCE_ROOT_ADDRESS=<balanceRoot>
INDEXER_START_BLOCK=<block>
INDEXER_ENABLED=true
RELAYER_ENABLED=true
SIGNER_ENABLED=true
GENESIS_SOURCE=chain
DEV_LOGIN=false
CHAIN_ID=84532
```

Then:

- Run `pnpm chain:check` again: every check, including "Vault trusts the engine signer key", must pass.
- **Start from an empty engine log.** Genesis must now come from the Vault, so a log that already holds a dev genesis cannot be reused. Stop the stack, then `docker compose down -v` (this deletes the local database volume), `pnpm infra:up` and `pnpm db:migrate`.

The guards behind this:

- With `GENESIS_SOURCE=chain` the engine waits for the Vault's `GenesisFunded`, which the indexer forwards.
- With contracts configured, the API turns off the sign-in play-money credit and the dev login, so every balance is backed by the Vault.

## 6. Run it

```bash
pnpm infra:up && pnpm db:migrate
pnpm --filter @euroedge/web build && scripts/stack.sh start
```

Open http://localhost:8080/en/trade and go through the flow:

1. **Sign in** with email or Google. Privy creates the wallet, and the server session is SIWE.
2. **Claim** in "Wallet & funds", e.g. 10 000. Your wallet signs and the relayer pays gas.
3. **Deposit** e.g. 8 000. It reaches the trading balance once Base marks the block **safe**. On Base Sepolia that takes a few minutes, because the indexer reads only safe blocks.
4. **Trade** in the order ticket as usual.
5. **Withdraw** e.g. 1 000. The engine reserves it, the signer authorises it within seconds, the relayer submits it, and it lands in your wallet. The list shows "Paid out" once the indexer sees it at a safe block.
6. **Balance root.** At the next full hour the root poster publishes a root, and `GET /api/proofs/<your address>` returns your proof.

Logs are in `.e2e-logs/`: `relayer.log`, `indexer.log`, `signer.log`, `engine.log`.

## If something is off

| Symptom                                    | Check                                                                                      |
| ------------------------------------------ | ------------------------------------------------------------------------------------------ |
| Panel says contracts are not live          | `TOKEN_ADDRESS`/`VAULT_ADDRESS` in `.env`, API restarted                                   |
| Claim/deposit "rejected: InvalidSignature" | Wallet on the wrong account; `CHAIN_ID=84532`; token address matches the deployment        |
| Deposit never credited                     | `indexer.log`; `INDEXER_START_BLOCK`; wait for the safe head; engine genesis applied first |
| Withdrawal stuck "Being authorised"        | `signer.log`; `SIGNER_ENABLED=true`; Vault's `engineSigner` = your signer key's address    |
| "rate-limited"                             | relayer: 5 per wallet / 20 per IP per hour (proposal)                                      |
| Relayer ETH low warning                    | top up the relayer address shown by `pnpm chain:check`                                     |
