#!/usr/bin/env bash
# boot.sh — One-command Kingdom system startup.
# Checks prerequisites, starts Redis if needed, launches team.js.
#
# Usage:
#   ./scripts/boot.sh           # full boot
#   ./scripts/boot.sh --check   # health check only (no start)

set -euo pipefail

KINGDOM="$(cd "$(dirname "$0")/.." && pwd)"
CHECK_ONLY=false
[[ "${1:-}" == "--check" ]] && CHECK_ONLY=true

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
NC='\033[0m'

ok()   { echo -e "  ${GREEN}OK${NC}  $1"; }
fail() { echo -e "  ${RED}FAIL${NC}  $1"; }
warn() { echo -e "  ${YELLOW}WARN${NC}  $1"; }

echo ""
echo "Kingdom System Boot"
echo "==========================================="

# ── 1. Node.js ──
if command -v node > /dev/null 2>&1; then
  NODE_VER=$(node -v)
  ok "Node.js $NODE_VER"
else
  fail "Node.js not found"
  exit 1
fi

# ── 2. npm dependencies ──
if [ -d "$KINGDOM/node_modules" ]; then
  ok "node_modules present"
else
  warn "node_modules missing — running npm install"
  cd "$KINGDOM" && npm install
fi

# ── 3. Redis ──
if redis-cli -p 6380 ping > /dev/null 2>&1; then
  ok "Redis :6380 responding"
else
  warn "Redis :6380 not responding"
  if command -v docker > /dev/null 2>&1; then
    echo "     Starting Redis via Docker..."
    docker compose -f "$KINGDOM/docker-compose.yml" up -d redis 2>/dev/null || \
    docker run -d --name kingdom-redis -p 6380:6379 redis:7-alpine 2>/dev/null || true
    sleep 2
    if redis-cli -p 6380 ping > /dev/null 2>&1; then
      ok "Redis :6380 started"
    else
      fail "Redis could not start"
      exit 1
    fi
  else
    fail "Docker not available — cannot auto-start Redis"
    exit 1
  fi
fi

# ── 4. .env file ──
if [ -f "$KINGDOM/.env" ]; then
  ok ".env file present"
else
  warn ".env missing — copy from .env.example"
  echo "     cp $KINGDOM/.env.example $KINGDOM/.env"
fi

# ── 5. Test quick check ──
echo ""
echo "  Running quick syntax check..."
cd "$KINGDOM"
ERRORS=0
for f in agent/core/*.js agent/team/*.js agent/interface/*.js agent/memory/*.js; do
  [ -f "$f" ] && node -c "$f" 2>/dev/null || { fail "Syntax error: $f"; ERRORS=$((ERRORS+1)); }
done
if [ $ERRORS -eq 0 ]; then
  ok "All agent files syntax valid"
else
  fail "$ERRORS syntax errors found"
  exit 1
fi

echo ""
echo "==========================================="

if $CHECK_ONLY; then
  echo -e "${GREEN}Health check passed. System ready.${NC}"
  exit 0
fi

# ── 6. Launch ──
echo -e "${GREEN}Starting Kingdom...${NC}"
echo ""
cd "$KINGDOM"
exec node --env-file=.env start.js
