#!/usr/bin/env bash
# Starts the backend services + web (production build) in the background for e2e runs.
# Usage: scripts/stack.sh start|stop   (expects infra up: postgres, valkey, caddy on :8080)
set -euo pipefail
cd "$(dirname "$0")/.."
LOGS=.e2e-logs
PIDS=$LOGS/pids
mkdir -p "$LOGS"

case "${1:-start}" in
  start)
    : > "$PIDS"
    for svc in ingest fv-service engine api; do
      # Detach fully (no inherited stdout) so callers piping our output don't hang.
      (cd "apps/$svc" && exec node --env-file-if-exists=../../.env src/main.ts) > "$LOGS/$svc.log" 2>&1 < /dev/null &
      echo $! >> "$PIDS"
    done
    (cd apps/web && exec pnpm exec next start --port 3000) > "$LOGS/web.log" 2>&1 < /dev/null &
    echo $! >> "$PIDS"
    # Wait for readiness: engine, fv-service (publishing), api, web via Caddy.
    for url in http://localhost:4010/ready http://localhost:4020/ready http://localhost:4000/ready http://localhost:8080/en; do
      for _ in $(seq 1 90); do
        if curl -sf -o /dev/null "$url"; then break; fi
        sleep 1
      done
      curl -sf -o /dev/null "$url" || { echo "not ready: $url"; tail -n 30 "$LOGS"/*.log; exit 1; }
    done
    echo "stack ready"
    ;;
  stop)
    if [ -f "$PIDS" ]; then xargs -r kill < "$PIDS" 2>/dev/null || true; fi
    ;;
esac
