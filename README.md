# Kingdom

> A real-world agentic operating system for building useful systems with shared knowledge, disciplined execution, and compounding memory.

## Origin Story

`kingdom` began as a Minecraft MVP.

That first world mattered because it proved a small team of agents could:

- share state through a common memory bus
- coordinate through explicit roles
- observe failures and improve behavior
- turn repeated actions into reusable skills

Minecraft is no longer the boundary of the project. It is the first proof that the system can work.

## What Kingdom Is Now

Kingdom is the operating system around a human-led, agent-assisted development workflow.

It combines:

- `BMAD` for planning, decomposition, and delivery structure
- `Redis Blackboard` for live coordination between agents and tools
- `Obsidian` as working memory and linked project context
- `NotebookLM` as grounded source memory
- `GoT` reasoning modules for relationship-aware knowledge synthesis
- `Claude Code`, `Codex`, and `Antigravity` as the main execution surfaces

The goal is not to build bots inside a game. The goal is to build real products, workflows, and systems that can improve reality outside the sandbox.

## System Planes

### 1. Planning Plane

BMAD workflows define:

- product briefs
- PRDs
- architecture
- epics and stories
- implementation readiness
- sprint checkpoints

### 2. Knowledge Plane

Knowledge is split intentionally:

- `Obsidian` holds working notes, ADRs, sessions, and project memory
- `NotebookLM` holds source-grounded research and reference material
- `GoT` turns notes, skills, failures, and patterns into connected reasoning assets

### 3. Execution Plane

Work is executed through:

- `Claude Code`
- `Codex`
- `Antigravity`
- local Node.js agents
- shared Blackboard channels

### 4. Governance Plane

Quality is enforced through:

- tests
- review loops
- verification workflows
- observability
- explicit safety and approval rules

## Repository Structure

```text
kingdom/
├── agent/               # Core runtime modules, interfaces, memory, team agents
├── config/              # Shared runtime configuration
├── docs/                # Audits, plans, doctrine, and future ADRs
├── scripts/             # Support scripts and demos
├── test/                # Native Node.js test suite
├── _bmad/               # BMAD workflow engine and role definitions
├── .claude/             # Claude commands, agents, and project skills
├── server/              # Legacy Minecraft MVP assets and origin-story adapter
└── README.md
```

## Current Direction

The near-term work is to finish the transition from a game-world agent stack to a reality-facing development system.

That means:

1. doctrine and roadmap alignment
2. green test baseline
3. knowledge plane integration
4. execution orchestration refactor
5. product-focused runtime flows

## Legacy Components

The Minecraft runtime remains in the repository as:

- origin story
- integration testbed
- optional adapter for sandbox experiments

It is no longer the definition of the project.

## Immediate Priorities

1. Align doctrine files with the new mission
2. Fix the current failing tests and re-establish a trusted baseline
3. Refactor Blackboard channels around work, knowledge, and governance
4. Formalize Obsidian, NotebookLM, and GoT as the shared knowledge system
5. Turn BMAD workflows into the default control plane for delivery
