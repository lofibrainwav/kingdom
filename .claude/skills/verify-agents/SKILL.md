---
name: verify-agents
description: Use when agent runtime files change and you need to verify base-class patterns, reconnect logic, safety boundaries, and expected task ownership.
---

# Agent Code Verification

## Purpose

1. **Team agent patterns** — all agents follow constructor + init + handler + shutdown lifecycle
2. **Blackboard integration** — agents use board.publish/subscribe for communication
3. **Status reporting** — agents call board.updateStatus on state changes
4. **Channel subscriptions** — each agent subscribes to its expected channel
5. **Graceful shutdown** — subscriber and board disconnect on shutdown

## When to Use
- After modifying any file in `agent/`
- After adding a new team agent
- When agents are silently disconnecting
- Before a PR that touches agent logic

## Related Files

| Directory | Files | Purpose |
|-----------|-------|---------|
| `agent/core/` | blackboard.js, logger.js, ReflexionEngine.js, memory-logger.js | Core infrastructure |
| `agent/team/` | pm-agent.js, architect.js, coder.js, decomposer.js, deployer.js, failure-agent.js, reviewer.js, swarm-orchestrator.js, watchdog-agent.js | 9 team agents |
| `agent/interface/` | dashboard.js, discord-bot.js, mcp-orchestrator.js, skill-pipeline.js, zettelkasten-hooks.js | External interfaces |
| `agent/memory/` | got-reasoner.js, rumination-engine.js, skill-zettelkasten.js, vault-sync.js | Knowledge layer |
| `agent/team.js` | (root) | Multi-agent launcher |
| `agent/OctivBot.js` | (root) | Legacy Minecraft adapter (exempt from checks) |

## Workflow

### Step 1: Verify Team Agent Lifecycle Pattern

All 9 agents in `agent/team/` must follow:
```bash
grep -n "constructor\|async init\|async shutdown\|this.agentId" agent/team/*.js
```

**PASS:** Each file has constructor, init(), shutdown(), and this.agentId = 'Kingdom_*'
**FAIL:** Missing lifecycle method.

### Step 2: Verify Blackboard Integration

```bash
grep -n "board.publish\|board.updateStatus\|board.createSubscriber" agent/team/*.js
```

**PASS:** Each agent uses board for pub/sub and status updates.
**FAIL:** Agent communicates outside Blackboard.

### Step 3: Verify Channel Subscriptions

Expected channel → agent mapping:
```bash
# PM Agent
grep "work:intake" agent/team/pm-agent.js

# Architect
grep "work:planning:init" agent/team/architect.js

# Decomposer
grep "work:planning:designed" agent/team/decomposer.js

# Coder
grep "work:planning:decomposed" agent/team/coder.js

# Reviewer
grep "governance:review:requested" agent/team/reviewer.js

# Failure Agent
grep "governance:review:rejected" agent/team/failure-agent.js

# Deployer
grep "governance:project:approved" agent/team/deployer.js
```

**PASS:** Each agent subscribes to its expected channel.
**FAIL:** Channel mismatch.

### Step 4: Verify Agent IDs

```bash
grep "this.agentId" agent/team/*.js
```

**PASS:** All IDs follow `Kingdom_*` pattern.
**FAIL:** Old `Octiv_*` pattern found.

### Step 5: Verify Graceful Shutdown

```bash
grep -n "subscriber.*disconnect\|board.*disconnect" agent/team/*.js
```

**PASS:** Both subscriber and board disconnect in shutdown().
**FAIL:** Resource leak on shutdown.

### Step 6: Verify Core Blackboard

```bash
grep -n "PREFIX\|kingdom:" agent/core/blackboard.js
```

**PASS:** PREFIX = 'kingdom:' found.
**FAIL:** Wrong prefix.

## Output Format

```markdown
| Check | File(s) | Status | Detail |
|-------|---------|--------|--------|
| Lifecycle pattern | agent/team/*.js | ✅ PASS | 9/9 agents |
| Blackboard integration | agent/team/*.js | ✅ PASS | |
| Channel subscriptions | agent/team/*.js | ✅ PASS | 7/7 matched |
| Agent IDs Kingdom_* | agent/team/*.js | ✅ PASS | |
| Graceful shutdown | agent/team/*.js | ✅ PASS | |
| Core PREFIX | agent/core/blackboard.js | ✅ PASS | kingdom: |
```

## Exceptions

1. **agent/OctivBot.js** — legacy Minecraft adapter, does not follow team agent pattern
2. **agent/team/swarm-orchestrator.js** — orchestrates other agents, may not subscribe to a channel
3. **agent/team/watchdog-agent.js** — timer-based, may not use standard subscriber pattern
4. **agent/interface/** — interface modules have different patterns (HTTP servers, Discord bot)
