#!/bin/bash
# Kingdom pre-commit hook — frictionless quality gate
# Install: ln -sf ../../scripts/pre-commit.sh .git/hooks/pre-commit
set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

fail() { echo -e "${RED}✗ $1${NC}"; exit 1; }
pass() { echo -e "${GREEN}✓ $1${NC}"; }

# 1. Syntax check staged .js files
STAGED_JS=$(git diff --cached --name-only --diff-filter=ACM | grep '\.js$' || true)
if [ -n "$STAGED_JS" ]; then
  for f in $STAGED_JS; do
    node --check "$f" 2>/dev/null || fail "Syntax error: $f"
  done
  pass "Syntax check ($(echo "$STAGED_JS" | wc -l | tr -d ' ') files)"
fi

# 2. No secrets in staged files
STAGED=$(git diff --cached --name-only --diff-filter=ACM || true)
if [ -n "$STAGED" ]; then
  SECRETS=$(git diff --cached -U0 -- $STAGED | grep -E '^\+.*((sk-ant-|ghp_|xoxb-|AKIA)[A-Za-z0-9])' | grep -v 'pre-commit' || true)
  if [ -n "$SECRETS" ]; then
    fail "Potential secret detected in staged changes"
  fi
  pass "No secrets"
fi

# 3. No .env or dump.rdb staged
FORBIDDEN=$(git diff --cached --name-only | grep -E '(^\.env$|dump\.rdb|\.obsidian/)' || true)
if [ -n "$FORBIDDEN" ]; then
  fail "Forbidden file staged: $FORBIDDEN"
fi
pass "No forbidden files"

# 4. scan-events: 0 dead, 0 phantom
SCAN=$(node scripts/scan-events.js 2>/dev/null)
DEAD=$(echo "$SCAN" | grep -o 'Dead events: [0-9]*' | grep -o '[0-9]*')
PHANTOM=$(echo "$SCAN" | grep -o 'Phantom listeners: [0-9]*' | grep -o '[0-9]*')
if [ "$DEAD" != "0" ]; then
  fail "Dead events: $DEAD (run: node scripts/scan-events.js)"
fi
if [ "$PHANTOM" != "0" ]; then
  fail "Phantom listeners: $PHANTOM (run: node scripts/scan-events.js)"
fi
pass "Event map clean (0 dead, 0 phantom)"

echo -e "${GREEN}All pre-commit checks passed${NC}"
