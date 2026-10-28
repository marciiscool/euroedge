#!/usr/bin/env bash
# Passes Base Sepolia ETH from the deployer to the relayer and the root poster (M5-14), so only
# one address has to be funded from a faucet. Usage: pnpm chain:fund [amount, default 0.002]
set -euo pipefail
cd "$(dirname "$0")/.."
BIN="${FOUNDRY_BIN:+$FOUNDRY_BIN/}"
AMOUNT="${1:-0.002}"
set -a
# shellcheck disable=SC1091
source .env
set +a
: "${DEPLOYER_PRIVATE_KEY:?missing}" "${RELAYER_PRIVATE_KEY:?missing}" "${ROOT_POSTER_PRIVATE_KEY:?missing}" "${BASE_SEPOLIA_RPC_URL:?missing}"
for KEY in "$RELAYER_PRIVATE_KEY" "$ROOT_POSTER_PRIVATE_KEY"; do
  TO="$("${BIN}cast" wallet address --private-key "$KEY")"
  "${BIN}cast" send "$TO" --value "${AMOUNT}ether" --private-key "$DEPLOYER_PRIVATE_KEY" --rpc-url "$BASE_SEPOLIA_RPC_URL" > /dev/null
  echo "sent $AMOUNT ETH to $TO"
done
