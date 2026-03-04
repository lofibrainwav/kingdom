---
name: health-monitor
description: Monitor health of Octiv infrastructure — Redis Blackboard, PaperMC server, and agent status. Use to diagnose connection issues and check system state.
---

# Health Monitor Skill

Monitors the Octiv sandbox infrastructure.

## When to Use
- Checking if Redis is running and connected
- Verifying PaperMC server is accessible
- Checking agent heartbeats in Blackboard
- Diagnosing why bots fail to connect

## Instructions

1. **Check Redis** (port 6380):
   ```bash
   docker compose ps
   docker exec octiv-redis redis-cli ping
   docker exec octiv-redis redis-cli keys "octiv:*"
   ```

2. **Check PaperMC** (port 25565):
   ```bash
   docker compose logs minecraft --tail 20
   ```

3. **Check agent status in Redis**:
   ```bash
   docker exec octiv-redis redis-cli get octiv:bot:status:latest
   docker exec octiv-redis redis-cli keys "octiv:agent:*"
   ```

4. **Run tests**:
   ```bash
   npm test
   ```

## Common Issues
- Redis not responding: `docker compose up -d redis`
- PaperMC slow start: wait 2-3 min on first run (downloads plugins)
- Bot not spawning: check `server.properties` has `online-mode=false`
