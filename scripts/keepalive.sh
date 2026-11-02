#!/usr/bin/env bash
# Restarts the local stack if it is down (e.g. after the Mac slept: macOS sleep stops OrbStack's
# engine). Meant to run every 2 minutes from the LaunchAgent in scripts/com.euroedge.keepalive.plist.
set -uo pipefail
cd "$(dirname "$0")/.."
export PATH="/opt/homebrew/bin:/opt/homebrew/opt/node@24/bin:/usr/local/bin:$HOME/.orbstack/bin:/usr/bin:/bin:/usr/sbin:/sbin"
mkdir -p .e2e-logs
LOCK=.e2e-logs/keepalive.lock
# One run at a time: a start takes a couple of minutes.
if ! mkdir "$LOCK" 2>/dev/null; then exit 0; fi
trap 'rmdir "$LOCK"' EXIT
if curl -sf -o /dev/null --max-time 5 http://localhost:4010/ready && curl -sf -o /dev/null --max-time 5 http://localhost:8080/en/trade; then
  exit 0
fi
echo "$(date '+%F %T') stack down, starting it" >> .e2e-logs/keepalive.log
scripts/local-up.sh >> .e2e-logs/keepalive.log 2>&1 && echo "$(date '+%F %T') stack up" >> .e2e-logs/keepalive.log
