#!/usr/bin/env bash
# Installs (or with `remove`, removes) the per-user LaunchAgent that keeps the local stack up.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$HOME/Library/LaunchAgents/com.euroedge.keepalive.plist"
launchctl bootout "gui/$(id -u)/com.euroedge.keepalive" 2>/dev/null || true
if [ "${1:-install}" = remove ]; then rm -f "$DEST"; echo "removed"; exit 0; fi
mkdir -p "$HOME/Library/LaunchAgents"
sed "s|__REPO__|$REPO|" "$REPO/scripts/com.euroedge.keepalive.plist" > "$DEST"
launchctl bootstrap "gui/$(id -u)" "$DEST"
echo "installed: checks every 2 minutes; log in $REPO/.e2e-logs/keepalive.log"
