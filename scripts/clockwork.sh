#!/usr/bin/env bash
# clockwork.sh — Kingdom daily/weekly automation.
# Called by launchd or cron. Runs the right tasks based on time-of-day.
#
# Usage:
#   ./scripts/clockwork.sh morning    # 07:00 — vault health + infra sync
#   ./scripts/clockwork.sh evening    # 23:00 — session digest
#   ./scripts/clockwork.sh weekly     # Sunday 09:00 — weekly review
#   ./scripts/clockwork.sh all        # run everything (manual trigger)
#
# Logs to: bb/kingdom/logs/clockwork-YYYY-MM-DD.log

set -euo pipefail

KINGDOM="$(cd "$(dirname "$0")/.." && pwd)"
BB="$(cd "$KINGDOM/.." && pwd)"
LOG_DIR="$KINGDOM/logs"
DATE=$(date '+%Y-%m-%d')
TIME=$(date '+%H:%M:%S')
LOG="$LOG_DIR/clockwork-$DATE.log"

mkdir -p "$LOG_DIR"

log() { echo "[$TIME] $1" | tee -a "$LOG"; }

# ── Prerequisites ──────────────────────────────────────
check_redis() {
  if redis-cli -p 6380 ping > /dev/null 2>&1; then
    return 0
  else
    log "WARN: Redis not available on :6380"
    return 1
  fi
}

check_node() {
  if command -v node > /dev/null 2>&1; then
    return 0
  else
    log "ERROR: node not found in PATH"
    return 1
  fi
}

# ── Tasks ──────────────────────────────────────────────

task_vault_health() {
  log "=== Vault Health Check + Auto-fix ==="
  cd "$KINGDOM"
  # Skip auto-fix if user has uncommitted vault changes (prevent conflict)
  if git -C "$BB" diff --quiet 2>/dev/null; then
    node scripts/vault-health.js --fix 2>&1 | tee -a "$LOG"
  else
    log "WARN: uncommitted vault changes detected — running health check only (no --fix)"
    node scripts/vault-health.js 2>&1 | tee -a "$LOG"
  fi
  log "vault-health: done"
}

task_sync_infra() {
  log "=== Sync Infrastructure ==="
  cd "$KINGDOM"
  node scripts/sync-to-vault.js --quick 2>&1 | tee -a "$LOG"
  log "sync-infra: done"
}

task_sync_session() {
  log "=== Sync Session Digest ==="
  cd "$KINGDOM"
  node scripts/sync-to-vault.js --session 2>&1 | tee -a "$LOG"
  log "sync-session: done"
}

task_weekly_review() {
  log "=== Weekly Review ==="
  cd "$KINGDOM"
  node scripts/sync-to-vault.js --review 2>&1 | tee -a "$LOG"
  log "weekly-review: done"
}

task_event_scan() {
  log "=== Event Scan (dead/phantom check) ==="
  cd "$KINGDOM"
  node scripts/scan-events.js 2>&1 | tee -a "$LOG"
  log "event-scan: done"
}

task_test_audit() {
  log "=== Test Quality Audit ==="
  cd "$KINGDOM"
  node scripts/test-audit.js 2>&1 | tee -a "$LOG"
  log "test-audit: done"
}

# ── Modes ──────────────────────────────────────────────

MODE="${1:-morning}"

log "========================================"
log "Clockwork [$MODE] — $DATE $TIME"
log "========================================"

check_node || exit 1

case "$MODE" in
  morning)
    task_vault_health
    task_sync_infra
    task_event_scan
    ;;
  evening)
    task_sync_session
    task_test_audit
    ;;
  weekly)
    task_vault_health
    task_sync_infra
    task_weekly_review
    ;;
  all)
    task_vault_health
    task_sync_infra
    task_event_scan
    task_sync_session
    task_test_audit
    ;;
  *)
    log "Unknown mode: $MODE (use: morning|evening|weekly|all)"
    exit 1
    ;;
esac

log "Clockwork [$MODE] complete."
