---
name: verify-tests
description: Use when changing runtime or test code and you need to confirm the suite passes, thresholds remain healthy, and agent coverage mappings still make sense.
---

# verify-tests

Verify that the Kingdom test suite is healthy and all agent files have coverage.

## When to Use

- After modifying any runtime file under `agent/`
- After adding, deleting, or restructuring tests
- Before claiming stability after a refactor
- When test count, suite count, or coverage expectations may have drifted

## Steps

1. Run `npm test 2>&1` and parse the output:
   - Extract: total tests, passed, failed, skipped counts
   - Extract: test file count and suite count
   - Flag any test files that had failures

2. Validate thresholds:
   - Total tests ≥ 365
   - Failed = 0
   - Test files ≥ 38

3. Coverage map — verify each agent file has a corresponding test:

### Core (agent/core/) — 9 files
| Agent File | Expected Test File |
|---|---|
| agent/core/blackboard.js | test/blackboard.test.js, test/blackboard-channels.test.js |
| agent/core/logger.js | test/logger.test.js |
| agent/core/ReflexionEngine.js | test/reflexion-engine.test.js |
| agent/core/api-clients.js | test/api-clients.test.js |
| agent/core/memory-logger.js | test/memory-logger.test.js |
| agent/core/event-schemas.js | test/event-schemas.test.js |
| agent/core/skill-evaluator.js | test/skill-evaluator.test.js |
| agent/core/task-closeout-orchestrator.js | test/task-closeout-orchestrator.test.js |
| agent/core/task-runner.js | test/task-runner.test.js |

### Team (agent/team/) — 9 agents
| Agent File | Expected Test File |
|---|---|
| agent/team/pm-agent.js | test/pm-agent.test.js |
| agent/team/architect.js | test/architect.test.js |
| agent/team/coder.js | test/coder.test.js |
| agent/team/decomposer.js | test/decomposer.test.js |
| agent/team/deployer.js | test/deployer.test.js |
| agent/team/failure-agent.js | test/failure-agent.test.js |
| agent/team/reviewer.js | test/reviewer.test.js |
| agent/team/swarm-orchestrator.js | test/swarm-orchestrator.test.js |
| agent/team/watchdog-agent.js | test/watchdog-agent.test.js |

### Interface (agent/interface/) — 3 files
| Agent File | Expected Test File |
|---|---|
| agent/interface/mcp-orchestrator.js | test/mcp-orchestrator.test.js |
| agent/interface/obsidian-dashboard.js | test/obsidian-dashboard.test.js |
| agent/interface/discord-bot.js | (no dedicated test — exempt, external API) |

### Memory (agent/memory/) — 7 files
| Agent File | Expected Test File |
|---|---|
| agent/memory/got-reasoner.js | test/got-reasoner.test.js |
| agent/memory/knowledge-operator.js | test/knowledge-operator.test.js |
| agent/memory/rumination-engine.js | test/rumination.test.js |
| agent/memory/skill-pipeline.js | test/skill-pipeline.test.js |
| agent/memory/skill-zettelkasten.js | test/zettelkasten.test.js |
| agent/memory/vault-sync.js | test/vault-sync.test.js |
| agent/memory/zettelkasten-hooks.js | test/zettelkasten-hooks.test.js |

### Infrastructure tests (no 1:1 agent mapping)
| Test File | Purpose |
|---|---|
| test/integration.test.js | Cross-agent pub/sub integration |
| test/pipeline-integration.test.js | Full pipeline flow |
| test/planning-continuation.test.js | Multi-step planning flow |
| test/mock-board.test.js | Shared mock fidelity validation |
| test/test-quality.test.js | Coverage map enforcement |
| test/notebooklm-ingestion-queue.test.js | NotebookLM ingestion |
| test/notebooklm-packet-queue.test.js | NotebookLM packets |
| test/notebooklm-promotion-queue.test.js | NotebookLM promotions |
| test/interface-copy.test.js | Interface utilities |

4. Report:
```
✅ Tests: 365 pass / 0 fail / 0 skip (38 files)
✅ Coverage: 28/29 agent files have tests (discord-bot exempt)
⚠️  Missing: [list any uncovered files]
```

## Implementation

1. Run the full suite and capture exact totals.
2. Compare current thresholds to the expected floor.
3. Review coverage mapping for files whose ownership changed.
4. Report mismatches directly instead of masking them with stale expectations.
