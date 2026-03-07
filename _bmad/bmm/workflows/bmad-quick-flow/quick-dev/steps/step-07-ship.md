---
name: 'step-07-ship'
description: 'Auto-commit, push, and sync — the energy blast after gathering is complete'
---

# Step 7: Ship (Auto-Commit + Push)

**Goal:** Fire the energy blast — commit all changes, push to remote, sync to vault.

This step runs automatically after step-06 resolves findings.
No user interaction needed — if tests pass, it ships.

---

## AVAILABLE STATE

From previous steps:

- `{baseline_commit}` - Git HEAD at workflow start
- `{execution_mode}` - "tech-spec" or "direct"
- All implementation complete, reviewed, findings resolved

---

## EXECUTION SEQUENCE

### 1. Final Test Gate

Run full test suite one last time:

```bash
npm test
```

**If tests fail:** HALT. Do not commit. Show failures and return to step-03.
**If tests pass:** Continue.

### 2. Test Quality Audit

```bash
node scripts/test-audit.js
```

Verify: 0 empty assertions, 0 weak assertions.
**If audit fails:** Fix assertions before continuing.

### 3. Event Scan

```bash
node scripts/scan-events.js
```

Check: no new phantom listeners introduced.

### 4. Stage Changes

Stage only the files changed during this workflow:

```bash
git diff --name-only {baseline_commit}  # tracked changes
git ls-files --others --exclude-standard  # new files
```

Stage each file individually — never `git add -A`.
Exclude: `.env`, `agent/logs/`, `node_modules/`, `.DS_Store`

### 5. Generate Commit Message

Analyze the diff to generate a commit message:

- **Emoji**: Match the change type (feature, fix, test, refactor, etc.)
- **Format**: `emoji Description of what was done`
- **Language**: English (code rule)
- **Co-Author**: Always include `Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>`

### 6. Commit

```bash
git commit -m "<generated message>"
```

### 7. Push

```bash
git push origin <current-branch>
```

**If push fails:** Report error. Commit is preserved locally.

### 8. Vault Sync (optional)

If the change is substantial (new agent, new feature, architecture change):

```bash
node scripts/sync-to-vault.js --quick
```

This updates `bb/01-Projects/kingdom/infrastructure.md` with current state.

---

## COMPLETION OUTPUT

```
=== SHIPPED ===

Commit: <hash> <message>
Branch: <branch>
Push: success/failed
Tests: <count> passed
Files: <count> changed

Ready for next task.
```

---

## SUCCESS METRICS

- All tests pass
- Test audit clean
- No new phantom events
- Commit created with descriptive message
- Push to remote successful
- Vault synced (if substantial change)

## FAILURE MODES

- Committing with failing tests
- Using `git add -A` (may include secrets or binaries)
- Not including Co-Authored-By
- Pushing to wrong branch
- Not reporting push failures
