---
name: vibe-coding-fix
description: Kingdom 시스템의 6가지 문제점을 우선순위 순서로 자동 수정하는 BMAD 워크플로우. PM → Architect → Coder → Reviewer → Deployer 에이전트 순으로 실행.
---

# Vibe Coding Fix Workflow

**Goal:** P1~P6 문제점을 우선순위 순서로 자동 감지 및 수정

**Your Role:** 당신은 Vibe Coding Fix 오케스트레이터입니다. PM-Agent로서 6개의 수정 태스크를 Blackboard에 게시하고, 각 에이전트(Architect, Coder, Reviewer, Deployer)가 순서대로 처리하도록 지휘합니다.

---

## WORKFLOW ARCHITECTURE

```
[PM-Agent — 오케스트레이터]
        │
        ├── Step 01: Environment & Dependency Audit   (5분)
        │   └─ Coder: package.json 누락 의존성 추가, .env 템플릿 생성
        │
        ├── Step 02: Redis Error Handler Hardening    (30분)  
        │   └─ Coder: 11개 에이전트에 .on('error') 핸들러 일괄 추가
        │
        ├── Step 03: vm Sandbox Implementation        (2~3시간)
        │   └─ Architect: 설계 → Coder: 구현 → Reviewer: 검증
        │
        ├── Step 04: Code Cleanup                     (15분)
        │   └─ Coder: timeouts.js 잔재 제거, discord-bot.js catch 보강
        │
        └── Step 05: Verification & Memory Save       (10분)
            └─ Deployer: npm test, git commit, Blackboard에 결과 기록
```

**통신 채널:** `octiv:vibe-fix:*` (Redis Blackboard)
**저장 위치:** `_bmad/core/workflows/vibe-coding-fix/`

---

## INITIALIZATION

Config from `{project-root}/_bmad/core/config.yaml`:
- `project_name`: Kingdom
- `output_folder`: workspace/
- `communication_language`: Korean

Problem Source: `_bmad/core/workflows/vibe-coding-fix/data/problem-report.json`

---

## EXECUTION

Execute step by step — **각 Step은 이전 Step의 성공을 전제로 합니다.**

### Step 01 — Environment & Dependency Audit
Load step: `./steps/step-01-env-deps.md`

### Step 02 — Redis Error Handler Hardening  
Load step: `./steps/step-02-redis-hardening.md`

### Step 03 — vm Sandbox Implementation
Load step: `./steps/step-03-vm-sandbox.md`

### Step 04 — Code Cleanup
Load step: `./steps/step-04-cleanup.md`

### Step 05 — Verification & Memory Save
Load step: `./steps/step-05-verify-and-save.md`

---

## WORKFLOW STATES

```yaml
---
stepsCompleted: []
workflowType: 'vibe-coding-fix'
project: 'Kingdom'
date: '{{date}}'
problems:
  P1_package_json: pending
  P2_env_missing: pending
  P3_vm_sandbox: pending
  P4_redis_handlers: pending
  P5_timeouts_cleanup: pending
  P6_empty_catch: pending
all_tests_pass: false
---
```

---

## SUCCESS CRITERIA

워크플로우 완료 기준:
- [ ] `npm install discord.js groq-sdk --save` 실행 완료
- [ ] `.env.example` 파일 생성 (DISCORD_BOT_TOKEN, DISCORD_CHANNEL_ID, OBSIDIAN_VAULT)
- [ ] 11개 에이전트 Redis subscriber 에러 핸들러 추가
- [ ] `skill-pipeline.js` vm 샌드박스 구현 (`node:vm`)
- [ ] `config/timeouts.js` Minecraft 잔재 제거
- [ ] `discord-bot.js` 빈 catch → `log.error()` 교체
- [ ] `npm run test` 127+ 테스트 PASS
- [ ] `git commit` 완료

---

## ROLLBACK STRATEGY

각 Step 실패 시:
1. `git stash` — 현재 변경사항 임시 저장
2. 에러 내용을 `octiv:vibe-fix:error` 채널에 게시
3. PM-Agent에게 보고 → 다음 Step 스킵 or 재시도 결정
