---
step: 01
name: env-deps
title: Environment & Dependency Audit
agent: coder
duration: 5min
priority: P1, P2
---

# Step 01 — Environment & Dependency Audit

## 담당 에이전트: Coder

## 목표
- P1: `package.json`에 `discord.js`, `groq-sdk` 누락 의존성 추가
- P2: `.env.example` 파일 생성하여 필수 환경변수 문서화

---

## Actions

### Action 1.1 — 누락 의존성 추가

```bash
# // turbo
npm install discord.js groq-sdk --save
```

검증:
```bash
node -e "const p=require('./package.json'); console.log('discord.js' in p.dependencies, 'groq-sdk' in p.dependencies);"
# Expected: true true
```

### Action 1.2 — .env.example 생성

파일: `/Users/brnestrm/bb/kingdom/.env.example`

```env
# === Blackboard (Redis) ===
BLACKBOARD_REDIS_URL=redis://localhost:6380

# === LLM Providers ===
ANTHROPIC_API_KEY=sk-ant-xxx
GROQ_API_KEY=gsk_xxx

# === Discord Bot ===
DISCORD_BOT_TOKEN=           # ⚠️ 필수: Bot Token (Discord Developer Portal)
DISCORD_CHANNEL_ID=          # ⚠️ 필수: 기본 채널 ID
DISCORD_GUILD_ID=            # Guild (서버) ID

# === Obsidian Vault ===
OBSIDIAN_VAULT=             # ⚠️ 필수: Vault 절대 경로 (예: /Users/xxx/ObsidianVault)

# === Skill System ===
SKILL_DAILY_LIMIT=5
SKILL_MIN_SUCCESS_RATE=0.7

# === Performance ===
HEARTBEAT_INTERVAL_MS=10000
VM_TIMEOUT_MS=3000
```

### Action 1.3 — .gitignore 확인

```bash
grep -q "^\.env$" .gitignore && echo "✅ .env already ignored" || echo "# Secrets\n.env" >> .gitignore
```

---

## Completion Check

```bash
node -c package.json && echo "✅ package.json valid"
test -f .env.example && echo "✅ .env.example exists"
```

## Blackboard 게시

```js
await board.publish('vibe-fix:step-01', {
  author: 'coder',
  status: 'completed',
  P1: 'discord.js, groq-sdk added',
  P2: '.env.example created',
});
```
