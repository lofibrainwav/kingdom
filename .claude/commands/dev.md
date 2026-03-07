# /dev — Kingdom Development Pipeline

Wraps BMAD quick-dev with Kingdom-specific automation boosters.
Structure: BMAD (구조) + Kingdom (자동화) = 에네르기파

## Flow

```
모으기 (Gather)                          쏘기 (Fire)
┌─────────────────────────────┐  ┌────────────────────────┐
│ Research → Plan → TDD Loop  │→│ Verify → Commit → Push  │
│ (steps 01-03)               │  │ (steps 04-07)           │
└─────────────────────────────┘  └────────────────────────┘
```

## Modes

### `/dev <feature description>` — Full pipeline
Triggers BMAD quick-dev with all 7 steps:
1. Mode Detection (baseline capture)
2. Context Gathering + **Grok Research** (auto-query if GROK_MCP_URL set)
3. Execute (TDD loop)
4. Self-Check (auto-verify: tests + audit + events)
5. Adversarial Review
6. Resolve Findings
7. **Ship** (auto-commit + push + vault sync)

**How to run:** Load `_bmad/bmm/workflows/bmad-quick-flow/quick-dev/workflow.md` and follow it.

### `/dev research <topic>` — Research only
Quick codebase + vault + Grok search:
```bash
GROK_MCP_URL=http://localhost:3100/ask node scripts/dev-research.js "<topic>"
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

## Kingdom Automation Boosters (integrated into BMAD steps)

### Step 02 Booster: Auto-Research
Before planning, auto-runs:
- `scripts/dev-research.js` — codebase + vault + Grok in one shot
- Feeds findings into the context gathering plan

### Step 04 Booster: Auto-Verify
After implementation, auto-runs:
- `npm test` — all tests must pass
- `node scripts/test-audit.js` — 0 weak, 0 empty
- `node scripts/scan-events.js` — 0 new phantoms

### Step 07 (NEW): Auto-Ship
After review resolves:
- Stage specific files (never `git add -A`)
- Generate emoji commit message
- `git commit` + `git push`
- `node scripts/sync-to-vault.js --quick` (if substantial)

## Rules
- Korean conversation, English code
- Research before code (search-first principle)
- Test before implement (TDD)
- Auto-commit on green
- Auto-push on commit
- 5-point set: code + test + team.js + schema + channel
- 3 failures = stop and ask
