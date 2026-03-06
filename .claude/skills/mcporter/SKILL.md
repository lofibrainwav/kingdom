---
name: mcporter
description: Use when explicitly working on the legacy Minecraft adapter, bot control flows, or maintenance of the original Kingdom sandbox integration.
---

# MCPorter Skill

Controls the legacy Minecraft adapter via mineflayer.

## When to Use
- Only when the task explicitly targets the Minecraft origin adapter
- Spawning a bot and verifying connection
- Implementing bot movement and pathfinding
- Mining blocks or building structures
- Crafting items in Minecraft

## Role In Kingdom

This is not the default Kingdom runtime.
It is preserved as:
- origin-story proof
- sandbox experimentation adapter
- legacy integration target

## Connection Details
- **Host**: localhost:25565
- **Mode**: offline (no authentication)
- **Version**: 1.21.1

## Instructions

1. **Create bot** using legacy OctivBot class (Minecraft adapter only):
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
docker exec kingdom-mc rcon-cli gamemode creative KingdomBot_builder-01
```

## Implementation

- Treat this skill as a legacy adapter guide, not a default runtime path.
- Keep adapter changes isolated from core Kingdom orchestration and knowledge-plane work.
- Port reusable ideas out of this adapter instead of expanding Minecraft-specific dependencies in core flows.
