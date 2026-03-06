# Kingdom — Vibe Coding Agent Workflow

## Mission Reset
- `kingdom` is now a real-world agentic operating system.
- Minecraft remains an origin-story adapter and optional sandbox, not the product boundary.
- When older sections mention Minecraft- or Kingdom-specific runtime details, treat them as legacy implementation context unless a task explicitly targets the Minecraft adapter.
- Default orientation for new work:
  - `BMAD` is the planning plane
  - `Obsidian + NotebookLM + GoT` are the knowledge plane
  - `Claude Code + Codex + Antigravity` are the execution plane
  - tests, review, and verification loops are the governance plane

## Language Rule
- **Conversation with user**: Korean
- **All code, comments, file content, commits**: English

## 🌐 Browser Automation Global Safety Rules
- **Always verify before acting**: 클릭/타입 전 반드시 스냅샷으로 확인 (`browser-recovery` SICAC)
- **Draft Only**: 이메일, 결제, 폼 제출 → 반드시 인간 승인 후 실행
- **Ask before acting**: 각 단계 완료 후 "Step X 완료, 계속할까요?" 확인
- **Auto rollback**: 에러 발생 시 자동 롤백 + 최대 3회 재시도, 실패 시 인간 보고
- **Max parallel**: Multi-Clauding 최대 10 세션 병렬 (세션 하나 느려도 나머지 보완)

---

## Session Workflow

### START → `/simplify start` (one command)
1. Load MEMORY.md + debugging.md + patterns.md + session-log + git log
2. Report state: Phase, last commit, next task, blockers
3. **VERIFY**: Check session-log.md "Changes That Need Verification" → run affected tests

### DURING SESSION
- `/batch test,lint,status` — quick health check
- `/loop tdd <feature>` — Red-Green-Refactor until tests pass
- `/loop fix <file>` — auto-fix until clean
- `/simplify plan <task>` — Plan Combo shortcut
- `/remember` — anytime you discover something worth keeping
- `/rc` — check remote control status

### Lead Developer Protocol (every feature/fix — MANDATORY)
1. **New code = new tests** (parallel creation, never 0% coverage)
2. **Agent/skill audit**: After architecture changes, verify configs match reality
3. **Parallel everything**: Independent reads, tests, file writes → concurrent
4. **Auto-push**: Test pass + commit → push (no asking)
5. **Stale kill**: Outdated refs in agents/skills → fix immediately inline
6. **NotebookLM sync**: Major milestone → update 1기+2기 sources (parallel via `add_source.py --all`)

### END → `/simplify end` (one command)
1. Syntax check all files + no secrets scan
2. Auto-commit with generated message
3. Save MEMORY.md + session-log
4. **NotebookLM sync**: Generate status report → `add_source.py --all` (1기+2기 parallel)
5. Report: "Memory saved. Next session picks up from [X]"

### Auto-Memory & Hooks (runs without manual intervention)
- **UserPromptSubmit**: Shows git/redis/docker/memory status on every prompt
- **PostToolUse(git commit)**: Logs commit to session-log automatically
- **PostToolUse(Edit)**: Auto-formats `agent/*.js` and `test/*.js` with prettier
- **PreCompact**: Saves full state before context compaction
- **PreToolUse(git commit)**: Syntax checks all agent files
- **PreToolUse(counter)**: Suggests `/compact` every 50 tool calls

---

## Orchestration Patterns (bkit 5)

Choose the right pattern for the task at hand:

| Pattern | When | Flow |
|---------|------|------|
| **Leader** (default) | AC implementation | pm → planner → tdd → dev → review → commit |
| **Council** | Design decisions | architect + security + dev → synthesize |
| **Swarm** | Large-scale parallel work | parallel dev + tdd, then review |
| **Pipeline** | Sequential dependencies | debug → dev → verify → commit |
| **Watchdog** | Safety-critical changes | dev + debug monitor + security monitor |

### Pattern Selection Guide
- AC task (AC-1~8) → **Leader**
- Bug fix / test failure → **Pipeline**
- Architecture decision → **Council**
- Multiple independent files → **Swarm**
- node:vm / RCON / external input → **Watchdog**

---

## Quick Tool Directory — use `/tool-index` for full reference

### When unsure → `kingdom-orchestrator`

### Agents (28 files — 9 team + 9 core + 3 interface + 7 memory)
| Agent | One-liner |
|-------|-----------|
| `kingdom-orchestrator` | **START HERE** for complex tasks |
| `pm-agent` | AC status, requirements, priorities, strategy |
| `planner` | Implementation step breakdown |
| `architect` | System design decisions |
| `dev-agent` | Write actual code |
| `tdd-guide` | Tests before code |
| `code-reviewer` | Code quality after writing |
| `security-reviewer` | External input / node:vm / RCON |
| `debug-agent` | Failures, crashes, CI red |
| `github-agent` | Commit / push / CI sync |
| `skill-agent` | Skill maintenance |
| `notebooklm-agent` | Knowledge base queries |
| `obsidian-agent` | Vault notes |

### Efficiency Commands (.claude/commands/)
| Command | What it does |
|---------|-------------|
| `/simplify start` | One-command session startup (replaces 5 manual steps) |
| `/simplify end` | One-command session shutdown |
| `/simplify plan <task>` | Plan Combo → plan.md in one shot |
| `/simplify fix <file>` | Quick fix with auto-verify |
| `/simplify ship` | Test → lint → commit → push |
| `/simplify debug <error>` | Systematic debug with auto-verify |
| `/batch test,lint,status` | Run multiple ops in parallel |
| `/loop tdd <feature>` | Red-Green-Refactor cycle until pass |
| `/loop fix <file>` | Auto-fix loop until clean (max 5 iter) |
| `/loop refactor <file>` | Iterative improvement with verify |
| `/loop deploy` | Build → test → deploy cycle |
| `/rc` | Remote control status / Discord bridge |
| `/auto-memory status` | Show all memory layer stats |
| `/eval <target>` | Feature completeness evaluation (pass@1 metrics) |
| `/learn [topic]` | Extract patterns from session → instincts |
| `/checkpoint [name]` | Save session state snapshot for recovery |

**BMAD Commands** (41 commands — `.claude/commands/bmad-*`):
Planning and methodology commands from the BMAD framework. Key ones:
| Command | What it does |
|---------|-------------|
| `/bmad-bmm-quick-dev` | Quick solo dev flow |
| `/bmad-bmm-create-prd` | Create product requirements |
| `/bmad-bmm-create-architecture` | Create architecture doc |
| `/bmad-bmm-code-review` | Structured code review |
| `/bmad-bmm-create-epics-and-stories` | Epic/story breakdown |

### Skills (26 Kingdom + 5 global + 3 utility — with SKILL.md)

**Kingdom project skills (26 — `.claude/skills/`):**
| Skill | When |
|-------|------|
| `cost-aware-llm-pipeline` | LLM model routing, cost optimization |
| `verification-loop` | 6-phase verification before PR |
| `search-first` | Search codebase before writing new code |
| `docker-patterns` | Docker and supporting service patterns |
| `autonomous-loops` | Loop pattern theory for `/loop` commands |
| `tool-index` | Full tool/agent/skill reference |
| `verify-implementation` | Verify feature implementation completeness |
| `verify-redis` | Redis connection and data verification |
| `verify-agents` | Agent config and syntax verification |
| `verify-tests` | Test suite health check |
| `verify-dependencies` | Dependency audit and security check |
| `verify-mcp` | MCP server status verification |
| `manage-skills` | Skill lifecycle management |
| `health-monitor` | System health monitoring |
| `dev-tool-belt` | Developer utility collection |
| `mcporter` | Legacy Minecraft adapter maintenance |
| `weather` | Legacy Minecraft adapter weather control |
| `first-day-survival` | Legacy origin mission reference |
| `browser-recovery` | Playwright MCP + Patchright failure recovery |
| `automated-debugging` | Automated debug workflows |
| `capability-registry` | Agent↔MCP↔Skill mapping reference |
| `agent-teams` | Multi-agent parallel orchestration |
| `chrome-browser-control` | DOM-aware Chrome automation via Playwright |
| `obsidian-sync` | Obsidian vault sync and reasoning trace cleanup |
| `workflow-recording` | Capture repetitive workflows as reusable skills |
| `accuracy-verification` | Zero-tolerance accuracy for audits, counts, existence claims |

**Kingdom global skills (5 — `~/.claude/skills/`):**
| Skill | When |
|-------|------|
| `/session-memory` | **Session start** (or use `/simplify start`) |
| `/save-memory` | **Session end** (or use `/simplify end`) |
| `/remember` | Mid-session insight |
| `/tdd-workflow` | Before new feature (or use `/loop tdd`) |
| `/security-review` | After auth, input handling, API changes |

**Utility global skills (3 — `~/.claude/skills/`):**
| Skill | When |
|-------|------|
| `backend-patterns` | Backend architecture, API design, DB optimization |
| `coding-standards` | TypeScript/JS/React/Node.js best practices |
| `notebooklm` | NotebookLM knowledge base queries |

### Superpowers (14 global methodology skills)
Installed from [obra/superpowers](https://github.com/obra/superpowers).
See `~/.claude/skills/{skill-name}/SKILL.md` for details.

| Skill | When |
|-------|------|
| `/brainstorming` | Before creative work — explore intent, requirements, design |
| `/writing-plans` | Multi-step task → structured plan document |
| `/executing-plans` | Execute a written plan with review checkpoints |
| `/test-driven-development` | TDD Iron Law — tests before implementation |
| `/systematic-debugging` | 4-stage debugging methodology |
| `/requesting-code-review` | After completing task — structured review request |
| `/receiving-code-review` | When receiving feedback — rigorous verification |
| `/verification-before-completion` | Before claiming done — evidence-based proof |
| `/finishing-a-development-branch` | Branch complete → merge/PR/cleanup decision |
| `/dispatching-parallel-agents` | 2+ independent tasks → parallel execution |
| `/subagent-driven-development` | Sub-agent based development pattern |
| `/using-git-worktrees` | Isolated feature development via worktrees |
| `/using-superpowers` | Meta — skill discovery and invocation discipline |
| `/writing-skills` | Meta — TDD-based skill authoring |

### MCP Servers — Scope Strategy

**Global** (`~/.claude/settings.json` + `~/.claude.json` user scope) — available in ALL projects:
| MCP | Purpose | Access | Status |
|-----|---------|--------|--------|
| `context7` | Library docs (Redis, SDKs, framework APIs) | read-only | ✅ Active |
| `notebooklm` | Knowledge base queries | read-only | ✅ Active |
| `github` | PR, CI, code search, issues | fine-grained PAT | ✅ Active |
| `filesystem` | Local file operations | project root only | ✅ Active |
| `memory` | Persistent knowledge graph | local | ✅ Active |
| `sequentialthinking` | Extended multi-step reasoning | read-only | ✅ Active |
| `playwright` | Browser testing, E2E automation | read-only | ✅ Active |
| `redis` | Redis data access (`redis-mcp`) | local | ⚠️ Requires Redis |
| `docker` | Container management (`mcp-server-docker`) | local | ⚠️ Requires Docker |

**Project** (`.mcp.json`) — Kingdom-specific:
| MCP | Purpose | Access | Status |
|-----|---------|--------|--------|
| `serena` | LSP semantic code analysis (`uvx` from git) | local workspace | ⚠️ Requires uvx |
| `supabase` | Database queries, schema management | `--read-only` flag | ✅ Token Ready |
| `sentry` | Error tracking, performance monitoring | read scopes only | ✅ Token Ready |
| `vercel` | Deploy, preview, environment vars | team-scoped token | ✅ Token Ready |
| `figma` | Design specs, component extraction | read-only token | ⚠️ Token Required |

**Summary**: 7 global active + 2 infra-dependent (redis, docker), 5 project (3 token ready + 1 uvx-dependent + 1 token required)

### MCP Security Policy

**Credentials**:
- ALL tokens via `${ENV_VAR}` references — NEVER hardcode in `.mcp.json`
- Token template: `.env.example` (committed) → `.env` (gitignored, never committed)
- Rotate tokens every 60-90 days
- Prefer secrets managers: `op run --` (1Password), `doppler run --`, `infisical run --`

**Access Levels**:
- `supabase`: ALWAYS `--read-only` in dev. Write access ONLY via migration CLI (`supabase db push`)
- `github`: Fine-grained PAT scoped to `lofibrainwav/kingdom` only. Scopes: `contents:read`, `issues:write`, `pull_requests:write`
- `sentry`: Auth token with `project:read`, `event:read` scopes only. NO `project:write`
- `figma`: Read-only personal access token. View access only
- `vercel`: Team-scoped token. Preview deploys only — production promotion requires manual approval
- `serena`: Local LSP analysis only. No network access. Workspace locked to project root

**Environment Separation**:
- `NODE_ENV=development`: `.env` with dev project refs, `--read-only` supabase
- `NODE_ENV=production`: `.env.production` with prod project refs, restricted token scopes
- NEVER share tokens between environments
- Separate Supabase project refs: `SUPABASE_PROJECT_REF` (dev) vs `SUPABASE_PROD_PROJECT_REF` (prod)

**CLI-First Rule**:
- Database migrations: `supabase db push` (CLI) — NOT via MCP
- Git operations: `git` / `gh` CLI — MCP github for read/search only
- Deployments: `vercel --prod` (CLI) — MCP vercel for preview/status only
- Redis: `redis-cli -p 6380` — NOT via MCP
- Docker: `docker compose` CLI — NOT via MCP

### MCP Combo Workflows

**Plan Combo** — `sequentialthinking` + `serena` → `plan.md`
> Use when: Starting new feature, refactoring, or architecture change
1. `sequentialthinking`: Decompose task into sub-problems, identify dependencies
2. `serena find_symbol`: Map existing codebase symbols (read-only)
3. `serena get_file_outline`: Get structure of files that need changes (read-only)
4. Synthesize into `plan.md` with: affected files, symbol changes, test strategy, risk assessment
5. Human review required before any write operations

**Debug Combo** — `sentry` + `serena` + `sequentialthinking`
> Use when: Production error or complex bug
1. `sentry`: Get error trace, affected users, frequency (read-only)
2. `serena find_symbol`: Locate the failing function and its callers (read-only)
3. `sequentialthinking`: Root cause analysis with full context → fix strategy
4. Fix via dev-agent or CLI — NOT via MCP write tools

**Ship Combo** — `playwright` + `vercel` + `sentry`
> Use when: Deploying changes
1. `playwright`: Run E2E tests on preview (read-only)
2. `vercel`: Deploy to preview ONLY (write, but preview-scoped)
3. Manual approval for production promotion
4. `sentry`: Monitor error rate post-deploy (read-only, 5 min window)

**Design-to-Code Combo** — `figma` + `serena` + `context7`
> Use when: Implementing UI from design specs
1. `figma`: Extract component specs, colors, spacing (read-only)
2. `serena find_symbol`: Find existing similar components (read-only)
3. `context7`: Get library docs for implementation patterns (read-only)
4. Write code via dev-agent with local file tools

**Refactor Combo** — `serena` + `sequentialthinking` + `github`
> Use when: Large-scale code changes
1. `serena get_file_outline`: Map all affected files (read-only)
2. `serena find_symbol`: Find all references to target symbols (read-only)
3. `sequentialthinking`: Plan safe refactoring order (dependency-aware)
4. Apply changes via dev-agent (local file edits)
5. `github`: Create PR with detailed diff summary (write: PR only)

**Tech Debt Combo** — `serena` + `sequentialthinking` + `sentry` + `github`
> Use when: Systematic tech debt reduction
1. `sentry`: Identify recurring errors and performance hotspots (read-only)
2. `serena find_symbol`: Map affected code paths (read-only)
3. `sequentialthinking`: Prioritize fixes by impact and dependency order
4. Apply fixes via dedicated teams (see Team Composition below)
5. `github`: Track progress via issues and PRs

### Parallel MCP Strategy
- **Independent queries** run in parallel (e.g., `context7` docs + `serena` symbols + `sentry` errors)
- **Sequential chains** when output depends on input (e.g., sentry error → serena find → fix)
- **Always** start with `sequentialthinking` for tasks with 3+ steps or unclear scope
- **Read before write**: All combos do read-only analysis first, write operations require explicit approval

### Team Composition for MCP-Powered Workflows

**Feature Team** (new features):
| Role | Agent | MCP Tools |
|------|-------|-----------|
| PM | `pm-agent` | github (issues), sentry (user impact) |
| Planner | `planner` | sequentialthinking, serena (outline) |
| Architect | `architect` | serena (symbols), context7 (docs) |
| Dev | `dev-agent` | serena (navigate), context7 (API docs) |
| TDD | `tdd-guide` | serena (find test targets) |
| Reviewer | `code-reviewer` | github (PR), serena (verify changes) |

**Debug Team** (production issues):
| Role | Agent | MCP Tools |
|------|-------|-----------|
| Triage | `debug-agent` | sentry (errors), serena (locate) |
| Analysis | `debug-agent` | sequentialthinking (root cause) |
| Fix | `dev-agent` | serena (navigate), context7 (docs) |
| Deploy | `github-agent` | github (PR), vercel (preview) |

**Tech Debt Team** (systematic cleanup):
| Role | Agent | MCP Tools |
|------|-------|-----------|
| Scan | `security-reviewer` | sentry (hotspots), serena (complexity) |
| Plan | `planner` | sequentialthinking (prioritize) |
| Execute | `dev-agent` (×3 parallel) | serena (refactor), context7 (docs) |
| Verify | `tdd-guide` + `code-reviewer` | playwright (E2E), github (PR) |

**Design Team** (UI/UX work):
| Role | Agent | MCP Tools |
|------|-------|-----------|
| Spec | `architect` | figma (extract), serena (existing components) |
| Dev | `dev-agent` | context7 (library docs), serena (navigate) |
| Test | `tdd-guide` | playwright (visual tests) |

### MCP Utilization Status

**MCP Utilization Matrix** — which agents actively use each MCP:

| MCP | Status | Used By (Agents) | Referenced By (Skills) |
|-----|--------|------------------|----------------------|
| `context7` | Active | dev-agent, architect, planner | search-first |
| `sequentialthinking` | Active | orchestrator, architect, planner, debug-agent | — |
| `playwright` | Active | notebooklm-agent | browser-recovery |
| `notebooklm` | Active | notebooklm-agent | notebooklm (global) |
| `github` | Active | pm-agent, code-reviewer, security-reviewer, github-agent | dev-tool-belt, verification-loop |
| `memory` | Active | orchestrator, architect, pm-agent, skill-agent, obsidian-agent | — |
| `filesystem` | Active | dev-agent, skill-agent, obsidian-agent | — |
| `redis` | Infra-dep | debug-agent | verify-redis, health-monitor |
| `docker` | Infra-dep | debug-agent | docker-patterns, health-monitor |
| `serena` | uvx-dep | planner, architect, dev-agent, tdd-guide, code-reviewer | search-first |
| `supabase` | Token Ready | (none) | — |
| `sentry` | Token Ready | (none) | — |
| `vercel` | Token Ready | (none) | — |
| `figma` | Token Req | (none) | — |

**Unused MCP Rationale** — why 4 MCPs remain inactive:

| MCP | Why Unused | Activation Condition |
|-----|-----------|---------------------|
| `supabase` | No web frontend/DB provisioned | When Kingdom dashboard needs persistent storage |
| `sentry` | No production deployment exists | When bots deploy to cloud (not local Docker) |
| `vercel` | No web frontend built | When dashboard UI ships |
| `figma` | No design specs created | When UI/UX design phase begins |

> Full mapping: see `capability-registry` skill for Agent↔MCP↔Skill cross-reference.

---

## Git Rules
- **Format**: `emoji Phase-N: English description`
- **Never commit**: `.env`, `vault/`, `TXT/`, `.obsidian/`, `node_modules/`, `dump.rdb`
- **CI/CD**: GitHub Actions runs `npm test` on every push to `main`

---

## Current Operating Focus
- Phase-3 stabilization: 312 tests green, pipeline bridge wired, all agents have author fields
- Codebase structure: `agent/core/` (9), `agent/team/` (9), `agent/interface/` (3), `agent/memory/` (7) = 28 files
- Team launcher: 11 services (9 agents + TaskCloseoutOrchestrator + KnowledgeOperator)
- Completed:
  1. ~~skill/control-layer cleanup~~ (Phase-2)
  2. ~~green test baseline restoration~~ (312/312 green)
  3. ~~Blackboard channel refactor~~ (`work:*`, `knowledge:*`, `execution:*`, `governance:*`)
  4. ~~E2E pipeline bridge~~ (review:approved → project:approved → deployer)
  5. ~~Author field enforcement~~ (all team agent publishes)
  6. ~~Dashboard security~~ (_sanitizeParam unit tests)
- Next priorities:
  1. E2E runtime validation (`npm run e2e` with live agents)
  2. Production deployment readiness (Sentry, Vercel, Supabase — blocked on infra)
  3. Dashboard HTTP/SSE test coverage expansion

---

## Key Infrastructure
- **Redis**: `localhost:6380` (Docker: 6379→6380)
- **Legacy PaperMC Adapter**: `localhost:25565` (only for Minecraft adapter work)
- **Legacy RCON**: `localhost:25575` / pw in `.env` (only for adapter work)
- **CI**: `.github/workflows/ci.yml`
- **Repo**: https://github.com/lofibrainwav/kingdom (main)

## NotebookLM Notebooks
| Name | ID | URL | Role |
|------|-----|-----|------|
| **1기** Kingdom Project Roadmap | `ae1281fe...` | `notebook/ae1281fe-6370-493f-a1bd-afed03263a88` | Director (총괄 감독) — blueprints, roadmap |
| **2기** OpenClaw Phase 2 | `4f8bd626...` | `notebook/4f8bd626-c548-454a-b36b-fb080d335530` | Legacy origin reference |

### NotebookLM Workflow
- **Source update** (session end / major milestone): `add_source.py --all --source-file report.txt`
- **Query** (get Gemini analysis): `ask_question.py --notebook-id ID --question "..."`
- **Sources = knowledge base** (persistent), **Chat = query interface** (ephemeral)
- **Always parallel**: 1기+2기 source updates run concurrently
- **Patchright auth**: `~/.claude/skills/notebooklm/.venv/bin/python` (Google login persisted)
