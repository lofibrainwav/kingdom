---
name: health-monitor
description: Use when checking Kingdom infrastructure health, workflow readiness, knowledge sync status, or legacy adapter availability before deeper debugging.
---

# Health Monitor Skill

Monitors the Kingdom operating system infrastructure.

## When to Use
- Checking if Redis Blackboard is running and reachable
- Verifying current agent/workflow status
- Checking whether knowledge sync paths are healthy
- Diagnosing infrastructure blockers before debugging code
- Checking legacy adapter health only when relevant

## Instructions

1. **Check Blackboard / Redis**:
   ```bash
   docker compose ps
   docker exec octiv-redis redis-cli ping
   docker exec octiv-redis redis-cli keys "octiv:*"
   ```

2. **Check process and port conflicts**:
   ```bash
   lsof -nP -iTCP -sTCP:LISTEN
   ```

3. **Check Blackboard status channels**:
   ```bash
   docker exec octiv-redis redis-cli keys "octiv:*status*"
   docker exec octiv-redis redis-cli keys "octiv:*knowledge*"
   ```

4. **Run baseline tests**:
   ```bash
   npm test
   ```

5. **Check legacy adapter only if needed**:
   ```bash
   docker compose logs minecraft --tail 20
   ```

## Common Issues
- Redis not responding: `docker compose up -d redis`
- Test baseline red: fix suite before trusting new runtime refactors
- Knowledge sync stale: verify Obsidian path, NotebookLM auth, and latest docs
- Legacy adapter unavailable: only relevant for Minecraft-specific tasks

## Implementation

- Start with infrastructure reachability before reading application logs.
- Confirm Blackboard and process health before blaming runtime code.
- Treat legacy adapter checks as optional unless the task explicitly depends on them.
