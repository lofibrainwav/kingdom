---
step: 03
name: vm-sandbox
title: node:vm Sandbox Implementation for SkillPipeline
agent: architect → coder → reviewer
duration: 2~3hr
priority: P3
---

# Step 03 — vm Sandbox Implementation

## 담당 에이전트: Architect (설계) → Coder (구현) → Reviewer (검증)

## 목표
`skill-pipeline.js`의 `validateSkill()` TODO를 `node:vm` 기반 샌드박스로 구현

---

## Architect 담당: 설계

### 샌드박스 설계 원칙
1. **격리**: 스킬 코드가 전역 객체에 접근 불가
2. **타임아웃**: `VM_TIMEOUT_MS` 내 미완료 시 강제 종료
3. **3회 검증**: 동일 코드를 3번 dry-run (재현성 확인)
4. **안전 컨텍스트**: `console.log`만 허용, `require`, `process` 차단

### 허용 API 목록
```js
const ALLOWED_GLOBALS = {
  console: { log: (...a) => safeLog(...a) },
  Math, JSON, Date,
  setTimeout: undefined,   // 금지
  setInterval: undefined,  // 금지
  process: undefined,      // 금지
  require: undefined,      // 금지
};
```

---

## Coder 담당: 구현

파일: `agent/memory/skill-pipeline.js`

```js
const vm = require('node:vm');

// 4.1: Sandbox validation via node:vm (3x dry-run)
async validateSkill(code, attempts = 3) {
  for (let i = 0; i < attempts; i++) {
    try {
      const sandbox = vm.createContext({
        console: { log: () => {} },
        Math,
        JSON,
        Date,
        result: undefined,
      });
      const script = new vm.Script(code, { timeout: T.VM_TIMEOUT_MS });
      script.runInContext(sandbox, { timeout: T.VM_TIMEOUT_MS });
    } catch (err) {
      log.warn('skill-pipeline', `vm validation failed (attempt ${i + 1})`, {
        error: err.message,
      });
      return false;
    }
  }
  log.info('skill-pipeline', 'vm validation passed (3/3)');
  return true;
}
```

---

## Reviewer 담당: 검증 체크리스트

- [ ] `require()` 호출 코드가 validateSkill에서 `false`를 반환하는가?
- [ ] `process.exit()` 호출 코드가 차단되는가?
- [ ] 정상 스킬 코드가 `true`를 반환하는가?
- [ ] 3초 초과 코드가 타임아웃으로 `false`를 반환하는가?
- [ ] `npm run test` 이후 `skill-pipeline` 관련 테스트 PASS?

---

## 테스트 추가

파일: `test/memory.test.js` 또는 `test/skill-pipeline.test.js`

```js
it('validateSkill: should reject require() calls', async () => {
  const result = await pipeline.validateSkill("require('fs').unlinkSync('/tmp/test')");
  assert.equal(result, false);
});

it('validateSkill: should approve safe math code', async () => {
  const result = await pipeline.validateSkill("const x = Math.sqrt(4);");
  assert.equal(result, true);
});
```

---

## Blackboard 게시

```js
await board.publish('vibe-fix:step-03', {
  author: 'reviewer',
  status: 'completed',
  P3: 'node:vm sandbox implemented and reviewed',
});
```
