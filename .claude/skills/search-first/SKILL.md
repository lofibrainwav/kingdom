---
name: search-first
description: Use when planning new code, dependencies, or architecture changes and you need to verify whether the codebase, docs, or existing tools already solve the problem.
---

# Search First

## Purpose
Before writing new code, systematically search for existing solutions in the codebase,
dependencies, and documentation. Prevents reinventing the wheel.

## When to Use

- Before writing a new helper, utility, or service
- Before adding a new npm dependency
- When a requested feature feels like it may already exist in the repo
- When refactoring and you need to find the current canonical implementation

## The Search-First Protocol

### Step 1: Need Analysis
Before coding, answer:
- What exactly do I need? (function, pattern, utility)
- Is this a common enough need that it likely exists already?
- What would it be called? (brainstorm 3-5 names)

### Step 2: Parallel Search (run concurrently)

**Codebase search:**
```
Grep: pattern for function/class name variations
Glob: **/*.js for related file names
Read: package.json for relevant dependencies
```

**Dependency search:**
```
node_modules/.package-lock.json — check if a dep already provides this
context7 MCP — search library docs for the feature
```

**Pattern search:**
```
Grep: similar patterns already used in codebase
Read: existing utility files (agent/*.js, config/*.js)
```

### Step 3: Evaluate Findings
| Finding | Action |
|---------|--------|
| Exact match in codebase | Use it directly, import/require |
| Similar pattern exists | Extend or adapt it |
| Dependency provides it | Use the dependency's API |
| Nothing found | Proceed to implement |

### Step 4: Decide
- **Reuse**: import existing code, document the dependency
- **Extend**: add to existing module, maintain backward compat
- **Create**: write new code with tests, consider if it belongs in a shared utility

### Step 5: Implement (only if Step 4 = Create)
- Place in the most logical existing module
- Follow existing naming conventions
- Add tests alongside implementation

## Kingdom-Specific Search Locations
| What | Where to look |
|------|---------------|
| Team agents | `agent/team/*.js` (9 agents) |
| Redis / Blackboard | `agent/core/blackboard.js` |
| Logging | `agent/core/logger.js` |
| Timeout constants | `config/timeouts.js` |
| Knowledge layer | `agent/memory/*.js` (GoT, rumination, zettelkasten, vault-sync) |
| Interfaces | `agent/interface/*.js` (dashboard, discord, MCP, skill-pipeline) |
| Test helpers | `test/*.test.js` (shared mock board pattern) |
| Legacy adapter | `agent/OctivBot.js` (Minecraft only) |

## Implementation

1. Search the codebase for existing names, modules, and patterns.
2. Search dependencies and docs for built-in support.
3. Reuse or extend existing code when possible.
4. Only create new code after the search evidence says it is necessary.

## Anti-Patterns
- Writing a helper that duplicates `lodash`/`underscore` functionality
- Creating a new file when the function belongs in an existing module
- Importing a large library for one small function
- Not checking if an existing agent/core module already provides the needed API
