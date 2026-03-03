# Octiv MVP — Claude Code Workflow

## Language Rule
- **Conversation with user**: Korean
- **All code, comments, file content**: English

## Session Workflow

### Session Start (ALWAYS do this first)
1. Use `/session-memory` skill to load full context
2. Read ROADMAP.md to confirm active Phase
3. Run `git log --oneline -5` to see recent work
4. Report current state to user before proceeding

### During Session
- Update MEMORY.md whenever new patterns/decisions are discovered
- Use skills explicitly: `/notebooklm`, `/tdd-workflow`, `/security-review`, etc.
- Commit frequently with meaningful messages
- Follow commit format: `emoji Phase-N: English description`

### Session End (ALWAYS do this last)
1. Use `/save-memory` skill to persist all learnings
2. Update ROADMAP.md if phase status changed
3. Push to GitHub: `git push origin main`
4. Tell user: memory saved, context ready for next session

---

## Project Overview
- **Repo**: https://github.com/octivofficial/mvp
- **Stack**: Node.js, mineflayer, Redis (port 6380), PaperMC 1.21.1 (port 25565)
- **Goal**: AI agent team survives first night in Minecraft autonomously
- **Current Phase**: See ROADMAP.md

## Key Paths
| Item | Path |
|------|------|
| Memory | `/Users/octiv/.claude/projects/-Users-octiv-Octiv-MVP/memory/` |
| Skills (global) | `~/.claude/skills/` |
| Skills (project) | `./skills/` |
| Agents | `./.claude/agents/` |
| Docker stack | `docker-compose.yml` |
| Redis port | 6380 (mapped from container 6379) |

## Available Skills (Global)
| Skill | Use Case |
|-------|----------|
| `/session-memory` | Load context at session start |
| `/save-memory` | Save context at session end |
| `/notebooklm` | Query Google NotebookLM notebooks |
| `/tdd-workflow` | Test-driven development workflow |
| `/security-review` | Security audit before commit |
| `/coding-standards` | Code quality enforcement |
| `/backend-patterns` | API and data layer patterns |

## Available Agents
| Agent | When to Use |
|-------|-------------|
| `architect` | Architecture decisions |
| `planner` | Phase/task planning |
| `code-reviewer` | Pre-commit code review |
| `security-reviewer` | Security audit |
| `tdd-guide` | TDD implementation guidance |

## Git & Commit Rules
- Language: English only in commits
- Format: `emoji Phase-N: short description`
- Examples:
  - `🎮 P2: add shelter construction (AC-2)`
  - `✅ P1: fix Redis reconnection logic`
  - `🔧 P3: integrate Leader-Builder vote system`
- Never commit: `.env`, `vault/`, `TXT/`, `.obsidian/`, `node_modules/`
- Always run tests before committing: `npm test`

## Architecture Quick Reference
- `agent/OctivBot.js` — base bot class
- `agent/blackboard.js` — Redis pub/sub (`octiv:` prefix, port 6380)
- `agent/team.js` — 5-agent orchestrator
- `agent/leader.js` — strategy + voting
- `agent/builder.js` — wood/shelter/tools (AC-1,2,3)
- `agent/safety.js` — threat detection AC-8, vm2 sandbox
- `test/` — Node.js native test runner (`npm test`)

## AC Progress Tracking
| AC | Description | Status |
|----|-------------|--------|
| AC-1 | Collect 16 wood logs | builder.js ✅ |
| AC-2 | Build 3×3×3 shelter | ❌ not implemented |
| AC-3 | Craft basic tools | builder.js ✅ |
| AC-4 | All agents gather in shelter | ❌ not implemented |
| AC-5 | Self-improvement on failure | ❌ stub only |
| AC-6 | Group Reflexion → system prompt | ❌ not connected |
| AC-7 | Memory logging to disk | ❌ not implemented |
| AC-8 | Threat detection (lava/fall/loop) | safety.js ✅ |

## NotebookLM MCP
- MCP server configured in `~/.claude/settings.json`
- Use `/notebooklm` skill or ask "Log me in to NotebookLM"
- Supports: source-grounded answers, zero hallucinations
- Phase 5 integration: connect Octiv strategy docs to NotebookLM

## Memory System
- `MEMORY.md` — auto-loaded each session (max 200 lines)
- `session-log.md` — chronological session history
- `debugging.md` — recurring issues and solutions
- Always update at session end using `/save-memory`
