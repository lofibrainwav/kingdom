---
name: strategy-engine
description: Strategic planning for the Octiv agent team. Use for deciding agent roles, mission prioritization, and Training vs Creative mode decisions.
---

# Strategy Engine Skill

Plans and coordinates the Octiv multi-agent team strategy.

## When to Use
- Deciding which AC to work on next
- Evaluating Training vs Creative mode
- Planning agent role assignments
- Reviewing AC progress and adjusting priorities

## Instructions

1. **Read current AC progress** from Redis:
   ```bash
   docker exec octiv-redis redis-cli keys "octiv:ac:*"
   ```

2. **Apply decision logic** from leader.js:
   - Progress ≥ 70% → switch to Creative mode
   - 2/3 team vote → switch mode
   - 3 consecutive failures → trigger Group Reflexion

3. **Priority order**: AC-1 → AC-3 → AC-2 → AC-4 → AC-5/6

4. **Report** mode decision via Blackboard:
   ```javascript
   await board.publish('leader:mode', { mode, progress });
   ```

## Mode Definitions
- **Training**: Survival mode, real resource gathering, real stakes
- **Creative**: Creative mode, rapid testing of builds and strategies
