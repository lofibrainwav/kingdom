---
name: mcporter
description: Minecraft bot control via mineflayer. Use for spawning bots, controlling movement, mining, building, and crafting in the PaperMC server.
---

# MCPorter Skill

Controls Minecraft bots via mineflayer on the Octiv PaperMC server.

## When to Use
- Spawning a bot and verifying connection
- Implementing bot movement and pathfinding
- Mining blocks or building structures
- Crafting items in Minecraft

## Connection Details
- **Host**: localhost:25565
- **Mode**: offline (no authentication)
- **Version**: 1.21.1

## Instructions

1. **Create bot** using OctivBot class:
   ```javascript
   const { OctivBot } = require('./agent/OctivBot');
   const bot = new OctivBot({ username: 'MyBot' });
   await bot.start();
   ```

2. **Navigation** via pathfinder:
   ```javascript
   const { GoalBlock, GoalNear } = require('mineflayer-pathfinder').goals;
   await bot.bot.pathfinder.goto(new GoalNear(x, y, z, 1));
   ```

3. **Mining**:
   ```javascript
   const block = bot.bot.findBlock({ matching: blockId, maxDistance: 32 });
   await bot.bot.dig(block);
   ```

4. **Chat commands**: `!status`, `!pos` are handled by OctivBot

## Server Admin
```bash
# Start server
docker compose up -d minecraft

# RCON commands
docker exec octiv-mc rcon-cli gamemode creative OctivBot_builder-01
```
