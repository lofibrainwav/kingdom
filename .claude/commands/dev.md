# /dev — Kingdom Development Pipeline (야전교범)

Structure: 충전(Charge) → 출진(Deploy) → 전투(Battle) → 수습(Debrief)
"무기 빼먹고 전장에 나가는 일 없도록"

## Battle Cycle

```
충전 (Charge)              출진 (Deploy)           전투 (Battle)              수습 (Debrief)
┌──────────────┐  90%+  ┌─────────────┐  명령  ┌──────────────────┐  녹색  ┌──────────────┐
│ Preflight    │──────→│ Report      │─────→│ Research→TDD→Ship │─────→│ Lessons      │
│ 야전교범 점검 │        │ 확신도 보고  │       │ 에네르기파         │       │ XP 수습       │
└──────────────┘        └─────────────┘       └──────────────────┘       └──────────────┘
```

## Modes

### `/dev <feature description>` — Full pipeline (야전교범 전체)
1. **Preflight**: `node scripts/preflight.js` — 모든 무기, 도구, 시스템 점검
2. **Report**: 90%+ 확신 시 출진 가능 보고 → 사령관(유저) 명령 대기
3. **Research**: `scripts/dev-research.js` + Grok + vault search
4. **Plan**: Context Gathering → BMAD step-02
5. **Execute**: TDD loop — BMAD step-03
6. **Verify**: tests + audit + events — BMAD step-04
7. **Review**: Adversarial review — BMAD step-05/06
8. **Ship**: auto-commit + push — BMAD step-07
9. **Debrief**: `node scripts/debrief.js --save` — 교훈 + XP 수습

**How to run:** Load `_bmad/bmm/workflows/bmad-quick-flow/quick-dev/workflow.md` and follow it.

### `/dev preflight` — Readiness check only (야전교범 점검만)
```bash
node scripts/preflight.js
```
Reports confidence level. 90%+ = ready.

### `/dev research <topic>` — Research only
Quick codebase + vault + Grok search:
```bash
node scripts/dev-research.js "<topic>"
```
Add `--save` to persist to `bb/02-Research/`.

### `/dev tdd <feature>` — TDD only (skip research)
Jump directly to BMAD step-03 (Execute) with TDD focus:
1. Write failing test first
2. Implement minimal code
3. Verify all tests pass
4. Auto-ship via step-07

### `/dev debug <error>` — Debug pipeline
1. Search codebase for error pattern
2. Check `bb/03-Skills/debugging.md` for known solutions
3. Query Grok if available
4. Propose fix → apply → test → auto-ship

### `/dev debrief` — Post-battle XP collection
```bash
node scripts/debrief.js --save
```
Analyzes session: accomplishments, lessons, cost, prevention, XP gained.

## Kingdom Automation Boosters (integrated into BMAD steps)

### Preflight Booster (NEW — before step-01)
Before ANY work, auto-runs:
- `scripts/preflight.js` — 6-category readiness check
- Infrastructure, Code integrity, MCP tools, Skills, Clockwork, Security
- Reports confidence % → awaits commander's deployment order

### Step 02 Booster: Auto-Research
Before planning, auto-runs:
- `scripts/dev-research.js` — codebase + vault + Grok in one shot
- Feeds findings into the context gathering plan

### Step 04 Booster: Auto-Verify
After implementation, auto-runs:
- `npm test` — all tests must pass
- `node scripts/test-audit.js` — 0 weak, 0 empty
- `node scripts/scan-events.js` — 0 new phantoms

### Step 07: Auto-Ship
After review resolves:
- Stage specific files (never `git add -A`)
- Generate emoji commit message
- `git commit` + `git push`
- `node scripts/sync-to-vault.js --quick` (if substantial)

### Debrief Booster (NEW — after step-07)
After every battle:
- `scripts/debrief.js --save` — auto-extract lessons
- What we accomplished, what we learned, what it cost
- How to prevent this fight next time
- XP calculation → vault persistence

## Philosophy (임무와 책임, 그리고 자유)
- **임무**: 어제보다 나은 코드를 만든다
- **책임**: 무기를 점검하고, 전투 후 교훈을 남긴다
- **자유**: 철저한 준비가 주는 확신 위에서 일사천리로 움직인다
- 전투 없이 이기는 게 최선 — 자동화로 전투 자체를 줄인다
- 교훈 없는 전투는 무모한 놀이 — debrief 없이 끝내지 마라

## Rules
- Korean conversation, English code
- Preflight before every mission (무기 점검 필수)
- Research before code (search-first principle)
- Test before implement (TDD)
- Auto-commit on green
- Auto-push on commit
- Debrief after every session (경험치 수습 필수)
- 5-point set: code + test + team.js + schema + channel
- 3 failures = stop and ask
