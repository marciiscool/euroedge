# Runbook — deploy the contracts (M5-07)

Contracts: `TestUSDC`, `Vault`, `BalanceRoot` (`contracts/src`). Review gate: math. Every contract change needs founder review before a deploy.

## Before you start

1. **Safe.** Create a Safe on Base Sepolia (app.safe.global), 2-of-3 recommended. Its address becomes `ADMIN_SAFE`. It ends up holding:
   - `DEFAULT_ADMIN_ROLE` on all three contracts;
   - `PAUSER_ROLE` on the Vault.
2. **Keys.** These must be separate keys (brief §12):
   - `DEPLOYER_PRIVATE_KEY`: holds a little Base Sepolia ETH and loses every role at the end.
   - `ENGINE_SIGNER_ADDRESS`: signs withdrawals (M5-08); KMS-backed outside local dev.
   - `ROOT_POSTER_ADDRESS`: posts hourly balance roots (defaults to the signer).
3. **Daily withdrawal limit.** `VAULT_DAILY_LIMIT` in µUSDC (default 1 000 000 tUSDC, a proposal).

## Deploy

From `contracts/`:

```bash
forge script script/Deploy.s.sol --rpc-url "$BASE_SEPOLIA_RPC_URL" --broadcast --verify --etherscan-api-key "$BASESCAN_API_KEY"
```

The script:

1. deploys the three contracts;
2. wires `TestUSDC.setVault`;
3. mints genesis (50 000 000 house + 5 000 000 insurance) into the Vault and records it (`GenesisFunded`, ADR-0013);
4. hands every admin and pauser role to the Safe and renounces the deployer's;
5. writes `deployments/<chainId>.json`. Commit that file.

`--verify` submits the sources to Basescan. If verification fails, re-run it with `forge verify-contract`.

## Check

- `cast call <vault> "genesisRecorded()(bool)"` → `true`
- `cast call <testUsdc> "balanceOf(address)(uint256)" <vault>` → `55000000000000`
- `cast call <vault> "hasRole(bytes32,address)(bool)" 0x00…00 <safe>` → `true`, and `false` for the deployer.
- The indexer (M5-09) turns `GenesisFunded` into the engine's `GenesisCapital`; no deposit is credited before it.

## Emergencies

- **Pause:** the Safe calls `Vault.pause()`. This stops deposits and withdrawals; `unpause()` resumes them.
- **Signer key leaked:** the Safe calls `Vault.setEngineSigner(new)`. Every outstanding authorisation of the old key dies at once. The daily limit caps what a leaked key can drain before that.
