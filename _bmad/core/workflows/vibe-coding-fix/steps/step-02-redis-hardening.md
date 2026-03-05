---
step: 02
name: redis-hardening
title: Redis Subscriber Error Handler Hardening
agent: coder
duration: 30min
priority: P4
---

# Step 02 — Redis Error Handler Hardening

## 담당 에이전트: Coder

## 목표
11개 에이전트의 Redis `subscribe()` 호출 이후 `.on('error', handler)` 추가

---

## 대상 파일 목록

```
agent/team/pm-agent.js
agent/team/architect.js
agent/team/coder.js
agent/team/reviewer.js
agent/team/failure-agent.js
agent/team/deployer.js
agent/team/decomposer.js
agent/team/swarm-orchestrator.js
agent/interface/dashboard.js
agent/memory/zettelkasten-hooks.js
agent/memory/vault-sync.js
```

---

## 수정 패턴

각 에이전트에서 `createSubscriber()` 이후 다음 패턴 적용:

### Before (문제 있는 패턴)
```js
const sub = await board.createSubscriber();
await sub.subscribe('channel:name', handler);
```

### After (안전한 패턴)
```js
const sub = await board.createSubscriber();
sub.on('error', (err) => log.error('agent-name', 'Redis sub error', { error: err.message }));
await sub.subscribe('channel:name', handler);
```

---

## 자동 검증

```bash
# 수정 후 에러 핸들러 누락 체크
node -e "
const fs = require('fs');
const files = require('child_process').execSync('find agent/ -name \"*.js\"').toString().trim().split('\n');
let issues = 0;
for (const f of files) {
  const c = fs.readFileSync(f,'utf8');
  if (c.includes('subscribe(') && !c.includes(\"on('error'\") && !c.includes('on(\"error\"')) {
    console.log('❌ STILL MISSING:', f); issues++;
  }
}
console.log(issues === 0 ? '✅ All subscribers have error handlers' : issues + ' remaining');
"
```

---

## Blackboard 게시

```js
await board.publish('vibe-fix:step-02', {
  author: 'coder',
  status: 'completed',
  P4: '11 Redis subscriber error handlers added',
});
```
