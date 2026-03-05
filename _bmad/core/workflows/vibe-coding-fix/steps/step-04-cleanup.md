---
step: 04
name: cleanup
title: Code Cleanup — Minecraft Remnants & Empty Catch Blocks
agent: coder
duration: 15min
priority: P5, P6
---

# Step 04 — Code Cleanup

## 담당 에이전트: Coder

## 목표
- P5: `config/timeouts.js` Minecraft 잔재 상수 제거
- P6: `discord-bot.js` 빈 catch 블록 → `log.error()` 교체

---

## Action 4.1 — timeouts.js 정리 (P5)

파일: `config/timeouts.js`

다음 상수들을 **삭제 또는 주석 처리**:

```js
// ❌ 삭제 대상 (Minecraft 전용, 현재 미사용)
PATHFINDER_TIMEOUT_MS      // MC pathfinder
SPAWN_GROUND_WAIT_MS       // MC spawn
BUILDER_SPAWN_INTERVAL_MS  // MC builder
EXPLORER_LOOP_INTERVAL_MS  // MC explorer
GATHERING_POLL_INTERVAL_MS // MC gathering
```

삭제 전 확인:
```bash
grep -rn "PATHFINDER_TIMEOUT_MS\|SPAWN_GROUND_WAIT_MS\|BUILDER_SPAWN_INTERVAL_MS\|EXPLORER_LOOP_INTERVAL_MS\|GATHERING_POLL_INTERVAL_MS" agent/ --include="*.js"
# 출력이 없어야 삭제 가능 (사용 중인 에이전트 없음)
```

---

## Action 4.2 — discord-bot.js 빈 catch 보강 (P6)

파일: `agent/interface/discord-bot.js`

### Before
```js
} catch {
  // 아무것도 없음
}
```

### After
```js
} catch (err) {
  log.error('discord-bot', 'unexpected error', { error: err?.message || String(err) });
}
```

대상 라인: 59, 688, 772, 776

---

## 검증

```bash
# Minecraft 상수가 실제로 사라졌는지 확인
grep -rn "PATHFINDER_TIMEOUT_MS" agent/ config/ --include="*.js" && echo "❌ STILL EXISTS" || echo "✅ Cleaned"

# 빈 catch 블록 잔존 확인
grep -n "catch {$" agent/interface/discord-bot.js && echo "❌ STILL EMPTY" || echo "✅ All catches have handlers"
```

---

## Blackboard 게시

```js
await board.publish('vibe-fix:step-04', {
  author: 'coder',
  status: 'completed',
  P5: 'Minecraft constants removed from timeouts.js',
  P6: 'Empty catch blocks replaced with log.error()',
});
```
