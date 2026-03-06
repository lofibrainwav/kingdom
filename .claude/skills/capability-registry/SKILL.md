---
name: capability-registry
description: Use when deciding which Kingdom agent, MCP tool, skill, or workflow should own a task, verification step, or legacy adapter responsibility.
---

# Capability Registry — Agent/MCP/Skill Mapping

## When to Use

- You are unsure which agent should own a task
- You need to map a workflow to the right MCP/tool pair
- You are deciding whether a task belongs to a legacy adapter or the core system
- You need a fast registry for verification ownership
- You are onboarding a new workflow into Kingdom

## Agent → MCP Tool Matrix

Which MCP tools each agent can leverage:

| Agent | MCP Tools | Notes |
|-------|-----------|-------|
| `kingdom-orchestrator` | sequentialthinking, memory | Delegates others to specialized agents |
| `pm-agent` | github, memory | Issues, project tracking |
| `planner` | sequentialthinking, serena, context7 | Task decomposition + plan generation |
| `architect` | serena, context7, sequentialthinking, memory | Design decisions with system context |
| `dev-agent` | context7, serena, filesystem | API docs + code navigation |
| `tdd-guide` | serena | Find test targets |
| `code-reviewer` | github, serena | PR review + reference tracking |
| `security-reviewer` | github | Dependency alerts, PR diffs |
| `debug-agent` | redis, docker, sequentialthinking | Infrastructure diagnosis |
| `github-agent` | github | CLI preferred; MCP for cross-repo |
| `skill-agent` | filesystem, memory | Skill file management |
| `notebooklm-agent` | notebooklm, playwright | Knowledge queries + browser automation |
| `obsidian-agent` | filesystem, memory | Vault file management |

## Skill → Agent Mapping

Which agent is responsible for executing each skill category:

| Skill | Primary Agent | Trigger |
|-------|--------------|---------|
| `verify-redis` | debug-agent | After Redis/Blackboard changes |
| `verify-agents` | code-reviewer | After agent/*.js changes |
| `verify-tests` | tdd-guide | After test modifications |
| `verify-dependencies` | security-reviewer | Before PR, after npm install |
| `verify-mcp` | skill-agent | After MCP config changes |
| `verify-implementation` | kingdom-orchestrator | Before PR — orchestrates all verify-* |
| `search-first` | dev-agent, planner | Before writing new code |
| `cost-aware-llm-pipeline` | dev-agent, architect | LLM API integration |
| `docker-patterns` | dev-agent, architect | Container architecture |
| `automated-debugging` | debug-agent | Crash investigation |
| `health-monitor` | debug-agent | Infrastructure diagnosis |
| `systematic-debugging` | debug-agent | Complex bug methodology |
| `browser-recovery` | notebooklm-agent | Playwright failure recovery |
| `verification-loop` | code-reviewer, github-agent | Pre-PR 6-phase check |
| `first-day-survival` | pm-agent, planner | Legacy origin mission |
| `manage-skills` | skill-agent | Skill lifecycle |

## MCP Status Matrix

| MCP | Status | Blocker | Used By (Agents) |
|-----|--------|---------|------------------|
| `context7` | Active | — | dev-agent, architect, planner |
| `sequentialthinking` | Active | — | orchestrator, architect, planner, debug-agent |
| `playwright` | Active | — | notebooklm-agent |
| `notebooklm` | Active | — | notebooklm-agent |
| `github` | Active | — | pm-agent, code-reviewer, security-reviewer, github-agent |
| `memory` | Active | — | orchestrator, architect, pm-agent, skill-agent, obsidian-agent |
| `filesystem` | Active | — | dev-agent, skill-agent, obsidian-agent |
| `redis` | Infra-dependent | Requires Docker Redis on 6380 | debug-agent |
| `docker` | Infra-dependent | Requires Docker daemon | debug-agent |
| `supabase` | Token Ready | DB not provisioned yet | (none — future: dev-agent) |
| `sentry` | Token Ready | No production deploy yet | (none — future: debug-agent) |
| `vercel` | Token Ready | No web frontend yet | (none — future: github-agent) |
| `serena` | uvx-dependent | Requires `uvx` runtime | planner, architect, dev-agent, tdd-guide, code-reviewer |
| `figma` | Token Required | Personal Access Token needed | (none — future: architect) |

## Task → Tool Quick Lookup

| I need to... | Agent | MCP | Skill |
|--------------|-------|-----|-------|
| Debug a crash | debug-agent | redis, docker | automated-debugging |
| Write new code | dev-agent | context7, serena | search-first |
| Plan a feature | planner | sequentialthinking, serena | — |
| Review code | code-reviewer | github, serena | verification-loop |
| Check security | security-reviewer | github | verify-dependencies |
| Run all verifications | kingdom-orchestrator | — | verify-implementation |
| Query grounded project docs | notebooklm-agent | notebooklm | — |
| Commit and push | github-agent | github | dev-tool-belt |
| Create/update skills | skill-agent | filesystem, memory | manage-skills |
| Document decisions | obsidian-agent | filesystem, memory | — |
| Design architecture | architect | serena, context7 | docker-patterns |
| Write tests first | tdd-guide | serena | verify-tests |

## Reference

- Treat this file as the routing table for `agent -> tool -> skill -> workflow`.
- Update it whenever new capabilities become reusable enough to affect orchestration decisions.
