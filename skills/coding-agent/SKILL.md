---
name: coding-agent
description: Code writing and modification for Octiv bot agents. Use for implementing new AC tasks, refactoring agent logic, and writing mineflayer bot code.
---

# Coding Agent Skill

Writes and modifies Octiv agent code (mineflayer, Redis, Node.js).

## When to Use
- Implementing new AC tasks (shelter, gathering, self-improvement)
- Refactoring agent logic in leader/builder/safety
- Writing new ReAct loop behaviors
- Debugging mineflayer bot behavior

## Instructions

1. **Always read the file before editing** (use Read tool)
2. **Follow patterns** from existing agent files:
   - Use `this.board.publish()` for Redis events
   - Use `this.board.updateAC()` to track AC progress
   - Log with `console.log('[AgentName] message')`
   - Wrap bot operations in try/catch with logReflexion on failure
3. **Test** with `npm test` before committing
4. **Language**: All comments and logs in English

## Code Patterns
```javascript
// AC task pattern
async doTask() {
  console.log(`[${this.id}] starting task`);
  try {
    // ... implementation
    await this.board.updateAC(this.id, N, 'done');
  } catch (err) {
    console.error(`[${this.id}] task error:`, err.message);
    await this.board.logReflexion(this.id, { error: err.message });
  }
}
```
