#!/usr/bin/env bash
# Deploys TestUSDC, Vault and BalanceRoot to Base Sepolia (M5-14) from the keys in .env,
# verifies them on Basescan and writes contracts/deployments/84532.json.
# Needs forge + cast on PATH (or FOUNDRY_BIN=/path/to/foundry/bin). Run `pnpm chain:check` first.
set -euo pipefail
cd "$(dirname "$0")/.."
BIN="${FOUNDRY_BIN:+$FOUNDRY_BIN/}"
set -a
# shellcheck disable=SC1091
source .env
set +a
: "${DEPLOYER_PRIVATE_KEY:?missing}" "${ENGINE_SIGNER_PRIVATE_KEY:?missing}" "${ROOT_POSTER_PRIVATE_KEY:?missing}"
: "${ADMIN_SAFE:?missing}" "${BASE_SEPOLIA_RPC_URL:?missing}" "${ETHERSCAN_API_KEY:?missing}"
ENGINE_SIGNER_ADDRESS="$("${BIN}cast" wallet address --private-key "$ENGINE_SIGNER_PRIVATE_KEY")"
ROOT_POSTER_ADDRESS="$("${BIN}cast" wallet address --private-key "$ROOT_POSTER_PRIVATE_KEY")"
export ENGINE_SIGNER_ADDRESS ROOT_POSTER_ADDRESS
echo "engine signer: $ENGINE_SIGNER_ADDRESS"
echo "root poster:   $ROOT_POSTER_ADDRESS"
echo "admin Safe:    $ADMIN_SAFE"
cd contracts
"${BIN}forge" script script/Deploy.s.sol \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" --broadcast \
  --verify --etherscan-api-key "$ETHERSCAN_API_KEY"
echo
cat deployments/84532.json
