---
name: weather
description: Get Minecraft in-game weather and time information for scheduling agent tasks. Use to plan daylight-dependent activities.
---

# Weather Skill

Manages in-game time and weather for agent scheduling.

## When to Use
- Scheduling wood collection during daylight (safer)
- Checking time until nightfall (triggers shelter requirement)
- Forcing clear weather for testing

## Instructions

1. **Check in-game time via RCON**:
   ```bash
   docker exec octiv-mc rcon-cli time query daytime
   docker exec octiv-mc rcon-cli time query gametime
   ```

2. **Force time/weather for testing**:
   ```bash
   docker exec octiv-mc rcon-cli time set day
   docker exec octiv-mc rcon-cli weather clear
   ```

3. **Minecraft time reference**:
   - Day: 0–12000 ticks
   - Sunset: 12000 ticks
   - Night/hostile mobs: 12543–23460 ticks
   - 1 real minute ≈ 17 game minutes (default)

4. **Agent decision**: If time > 11000, prioritize shelter (AC-2/AC-4) over wood.
