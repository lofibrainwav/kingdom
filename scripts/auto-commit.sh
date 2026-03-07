#!/usr/bin/env bash
# auto-commit.sh — Auto-commit after successful test run.
# Called by hooks or /dev pipeline. Only commits if tests pass.
#
# Usage:
#   ./scripts/auto-commit.sh              # commit only
#   ./scripts/auto-commit.sh --push       # commit + push
#   ./scripts/auto-commit.sh --dry-run    # show what would be committed

set -euo pipefail

KINGDOM="$(cd "$(dirname "$0")/.." && pwd)"
cd "$KINGDOM"

DRY_RUN=false
DO_PUSH=false
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    --push) DO_PUSH=true ;;
  esac
done

# ── 1. Check for changes ──
CHANGED=$(git diff --name-only 2>/dev/null)
STAGED=$(git diff --cached --name-only 2>/dev/null)
UNTRACKED=$(git ls-files --others --exclude-standard 2>/dev/null | grep -E '\.(js|json|md|yml|yaml|sh)$' || true)

if [ -z "$CHANGED" ] && [ -z "$STAGED" ] && [ -z "$UNTRACKED" ]; then
  echo "[auto-commit] No changes to commit."
  exit 0
fi

# ── 2. Run tests ──
echo "[auto-commit] Running tests..."
if ! npm test --silent 2>/dev/null; then
  echo "[auto-commit] ABORT: Tests failed. Not committing."
  exit 1
fi

# ── 3. Generate commit message ──
ALL_FILES=$(echo -e "$CHANGED\n$STAGED\n$UNTRACKED" | sort -u | grep -v '^$')
FILE_COUNT=$(echo "$ALL_FILES" | wc -l | tr -d ' ')

# Detect change type from file paths
EMOJI="🔧"
if echo "$ALL_FILES" | grep -q "test/"; then
  EMOJI="🧪"
fi
if echo "$ALL_FILES" | grep -q "agent/"; then
  EMOJI="🤖"
fi
if [ "$FILE_COUNT" -gt 5 ]; then
  EMOJI="📦"
fi

# Build summary from git diff
SUMMARY=$(git diff --stat 2>/dev/null | tail -1 | sed 's/^ *//')
if [ -z "$SUMMARY" ]; then
  SUMMARY="$FILE_COUNT file(s) changed"
fi

MSG="$EMOJI Auto-commit: $SUMMARY"

# ── 4. Dry run ──
if $DRY_RUN; then
  echo "[auto-commit] DRY RUN — would commit:"
  echo "  Message: $MSG"
  echo "  Files:"
  echo "$ALL_FILES" | sed 's/^/    /'
  exit 0
fi

# ── 5. Stage and commit ──
# Stage tracked changes
if [ -n "$CHANGED" ]; then
  echo "$CHANGED" | xargs git add
fi
# Stage new files (only code/config, not binaries)
if [ -n "$UNTRACKED" ]; then
  echo "$UNTRACKED" | xargs git add
fi

git commit -m "$MSG

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"

echo "[auto-commit] Committed: $MSG"

# ── 6. Push ──
if $DO_PUSH; then
  BRANCH=$(git branch --show-current 2>/dev/null || echo "main")
  echo "[auto-commit] Pushing to origin/$BRANCH..."
  if git push origin "$BRANCH" 2>/dev/null; then
    echo "[auto-commit] Pushed successfully."
  else
    echo "[auto-commit] Push failed — commit preserved locally."
  fi
fi
