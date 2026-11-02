#!/usr/bin/env bash
# Brings the whole local stack up from any state (M5-14): OrbStack's Docker engine, Postgres/Valkey/
# Caddy, migrations, a web build with the Privy id from .env, then all services. Safe to re-run.
# Usage: pnpm local:up
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.orbstack/bin:$PATH"
# No global pnpm needed: corepack (bundled with Node) runs the repo's pinned version.
if ! command -v pnpm >/dev/null 2>&1; then
  pnpm() { corepack pnpm "$@"; }
  export -f pnpm
fi

if ! docker info >/dev/null 2>&1; then
  echo "starting the Docker engine (OrbStack)…"
  # Let the OrbStack app start its own engine (owned by launchd). An engine started with
  # `orb start` from a terminal session was stopped again later, along with that session.
  if pgrep -x OrbStack >/dev/null; then
    osascript -e 'quit app "OrbStack"' >/dev/null 2>&1 || true
    for _ in $(seq 1 15); do pgrep -x OrbStack >/dev/null || break; sleep 1; done
  fi
  open -a OrbStack
  for _ in $(seq 1 60); do docker info >/dev/null 2>&1 && break; sleep 2; done
  docker info >/dev/null 2>&1 || { echo "Docker engine did not start"; exit 1; }
fi

docker compose up -d --wait
pnpm -s db:migrate

# NEXT_PUBLIC_* are baked in at build time; NODE_ENV from .env must not reach `next build`.
(set -a && source .env && set +a && unset NODE_ENV && pnpm --filter @euroedge/web build > .e2e-logs/web-build.log 2>&1) \
  || { echo "web build failed: see .e2e-logs/web-build.log"; exit 1; }

scripts/stack.sh stop
sleep 2
scripts/stack.sh start
echo "open http://localhost:8080/en/trade"
