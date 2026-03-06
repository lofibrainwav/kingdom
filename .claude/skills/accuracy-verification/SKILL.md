---
name: accuracy-verification
description: Use when producing audit reports, counting files/tests, or making binary existence claims (X exists / X is missing). Enforces zero-tolerance accuracy protocol.
---

# accuracy-verification

Cross-verify all factual claims before reporting. Agent reports are NOT trusted by default.

## When to Use

- Before reporting test counts, file counts, agent counts
- Before claiming "X is missing" or "X doesn't exist"
- When summarizing audit/scan results
- When updating CLAUDE.md, SKILL.md thresholds, or CI config numbers

## Protocol

### 1. Counts — always verify with a command

| Claim | Verify With |
|-------|------------|
| "N tests pass" | Parse actual `npm test` output |
| "N agent files" | `ls agent/**/*.js \| wc -l` |
| "N skills" | `ls .claude/skills/ \| wc -l` |
| "N test files" | `ls test/*.test.js \| wc -l` |

Never quote a number from memory. Run the command, read the output, report the number.

### 2. Existence — always grep before claiming

| Claim | Verify With |
|-------|------------|
| "Channel X is missing from CHANNEL_RULES" | `grep 'X' agent/core/blackboard.js` |
| "Function Y is unused" | `grep -r 'Y' agent/ test/` |
| "File Z doesn't exist" | `ls path/to/Z` |
| "Config key not set" | `grep 'key' .env.example` |

**Never claim absence from partial file reads.** Use grep on the full file.

### 3. Cross-verification for agent reports

When a sub-agent reports findings:
1. Pick the 2-3 most critical claims
2. Verify each with a direct grep/ls/read
3. If ANY claim is wrong, re-verify ALL claims before acting
4. Flag the inaccuracy to the user

### 4. Document-code sync

Before updating any threshold or count in docs:
1. Get the actual current value from the source of truth
2. Update the document to match
3. Never round, estimate, or "bump" without verification

## Anti-Patterns (banned)

- Trusting sub-agent "X is missing" reports without grep
- Quoting test counts from memory instead of npm test output
- Reading only part of a file and concluding something is absent
- Adding items to EXEMPT lists without justification
- Updating thresholds without running the actual check first

## Origin

Created after a sub-agent reported `governance:project:approved` was missing from CHANNEL_RULES — it was actually at line 68. The agent had only partially read the file.
