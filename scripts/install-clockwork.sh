#!/usr/bin/env bash
# install-clockwork.sh — Install/uninstall Kingdom LaunchAgents.
#
# Usage:
#   ./scripts/install-clockwork.sh install    # symlink plists + load
#   ./scripts/install-clockwork.sh uninstall  # unload + remove symlinks
#   ./scripts/install-clockwork.sh status     # show loaded state

set -euo pipefail

KINGDOM="$(cd "$(dirname "$0")/.." && pwd)"
PLIST_DIR="$KINGDOM/scripts/launchd"
AGENTS_DIR="$HOME/Library/LaunchAgents"
PLISTS=(
  com.kingdom.clockwork-morning
  com.kingdom.clockwork-evening
  com.kingdom.clockwork-weekly
)

case "${1:-status}" in
  install)
    mkdir -p "$AGENTS_DIR" "$KINGDOM/logs"
    for name in "${PLISTS[@]}"; do
      src="$PLIST_DIR/$name.plist"
      dst="$AGENTS_DIR/$name.plist"
      if [ -f "$dst" ]; then
        launchctl unload "$dst" 2>/dev/null || true
        rm "$dst"
      fi
      ln -s "$src" "$dst"
      launchctl load "$dst"
      echo "  Loaded: $name"
    done
    echo ""
    echo "Kingdom clockwork installed. Schedule:"
    echo "  07:00 daily  — vault health + infra sync + event scan"
    echo "  23:00 daily  — session digest + test audit"
    echo "  09:00 Sunday — weekly review"
    echo ""
    echo "Logs: $KINGDOM/logs/"
    ;;
  uninstall)
    for name in "${PLISTS[@]}"; do
      dst="$AGENTS_DIR/$name.plist"
      if [ -f "$dst" ]; then
        launchctl unload "$dst" 2>/dev/null || true
        rm "$dst"
        echo "  Removed: $name"
      fi
    done
    echo "Kingdom clockwork uninstalled."
    ;;
  status)
    echo "Kingdom Clockwork Status:"
    echo ""
    for name in "${PLISTS[@]}"; do
      dst="$AGENTS_DIR/$name.plist"
      if [ -f "$dst" ]; then
        if launchctl list "$name" > /dev/null 2>&1; then
          echo "  [ACTIVE]   $name"
        else
          echo "  [LOADED]   $name (not yet triggered)"
        fi
      else
        echo "  [MISSING]  $name"
      fi
    done
    echo ""
    echo "Recent logs:"
    ls -lt "$KINGDOM/logs/clockwork-"*.log 2>/dev/null | head -3 || echo "  (no logs yet)"
    ;;
  *)
    echo "Usage: $0 {install|uninstall|status}"
    exit 1
    ;;
esac
