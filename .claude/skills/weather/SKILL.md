---
name: weather
description: Use when working on the legacy Minecraft adapter and in-game time or weather controls affect testing, safety, or mission timing.
---

# Weather Skill

Manages in-game time and weather for the legacy Minecraft adapter.

## Role In Kingdom

This skill is preserved only for origin-story adapter work.
It is not part of the default real-world Kingdom operating model.

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

## Implementation

- Use these controls only inside the legacy adapter workflow.
- Prefer deterministic test conditions when validating the Minecraft origin mission.
- Keep weather/time mutations out of core Kingdom runtime assumptions.
