# Kingdom Roadmap

> **Mission**: Build a real-world agentic operating system that helps humans and agents create useful products, workflows, and knowledge systems together.
>
> **Spirit**: Truth, Goodness, Beauty, Serenity, Eternity
>
> **Date**: 2026-03-05

---

## Strategic Reframe

Kingdom started as a Minecraft MVP. That phase proved the core pattern:

- role-based agents
- shared memory via Redis
- self-observation
- reusable skills
- human-directed orchestration

The next chapter uses the same pattern in the real world.

Minecraft remains in-repo as an origin-story adapter and sandbox, not as the defining product scope.

---

## Core System

| Plane | Purpose | Core Assets |
|------|---------|-------------|
| Planning Plane | Turn goals into structured work | `_bmad/`, `.claude/commands/`, PRDs, architecture docs |
| Knowledge Plane | Preserve and connect context | Obsidian, NotebookLM, GoT, Zettelkasten, vault sync |
| Execution Plane | Deliver real work through agents and tools | Claude Code, Codex, Antigravity, team agents, Blackboard |
| Governance Plane | Keep quality, safety, and trust high | tests, reviews, verification loops, observability |

---

## Phase 1 — Doctrine And Context Reset

**Goal:** Make the repository tell the truth about what Kingdom is now.

### Deliverables
- Rewrite doctrine docs around the real-world mission
- Freeze canonical vocabulary for planes, agents, channels, and knowledge assets
- Mark Minecraft as legacy/origin adapter
- Align `README`, `SOUL`, `ROADMAP`, and future `CLAUDE` instructions

### Success Criteria
- No core document describes Kingdom as Minecraft-only
- New contributors can explain the four planes correctly after reading the docs
- BMAD is explicit as the default planning/control layer

### Dependencies
- Existing `_bmad` and `.claude` assets
- Current audit and roadmap docs

---

## Phase 2 — Knowledge Plane Integration

**Goal:** Turn scattered notes and memories into a usable shared intelligence layer.

### Deliverables
- Define note types and sync rules for Obsidian
- Define source ingestion policy for NotebookLM
- Formalize GoT node and edge types
- Publish knowledge-update events through Blackboard
- Connect `skill-zettelkasten`, `got-reasoner`, `rumination-engine`, and `vault-sync`

### Success Criteria
- A project decision can be traced from source -> note -> GoT relationship -> agent retrieval
- Agents can retrieve grounded context without re-explaining the project
- Obsidian and NotebookLM have distinct, non-overlapping responsibilities

### Dependencies
- Phase 1 doctrine reset
- Stable local vault and NotebookLM workflow

---

## Phase 3 — Execution Plane Refactor

**Goal:** Refactor runtime orchestration from game-centric events to real work execution.

### Deliverables
- Redesign Blackboard channels around:
  - `work:*`
  - `knowledge:*`
  - `governance:*`
  - `execution:*`
- Reframe team roles:
  - `pm-agent` -> intake and decomposition
  - `architect` -> structural decisions
  - `coder` -> implementation
  - `reviewer` -> code and design review
  - `watchdog/failure-agent` -> blocked state and recovery
- Reposition `swarm-orchestrator` as execution dispatcher

### Success Criteria
- Stories and tasks can be assigned through shared runtime channels
- Execution status is visible without relying on Minecraft state
- Claude Code, Codex, and Antigravity can operate on the same shared work graph

### Dependencies
- Phase 1 doctrine reset
- Green test baseline

---

## Phase 4 — Governance And Observability

**Goal:** Increase trust so the system can safely operate with more autonomy.

### Deliverables
- Fix failing tests and restore green baseline
- Expand test coverage around orchestration boundaries
- Standardize verification loops before merge or deploy
- Add dashboards and logs for work progress, knowledge sync, and failures
- Harden approval boundaries for external effects

### Success Criteria
- Test suite is trusted again as the baseline guardrail
- Important state transitions are observable in logs or dashboard views
- High-risk actions require explicit approval or documented automation policy

### Dependencies
- Phase 3 execution refactor

---

## Phase 5 — Product Compounding

**Goal:** Turn the operating system into a compounding engine for building real things.

### Deliverables
- Capture recurring workflows as reusable commands or skills
- Convert successful execution patterns into BMAD templates
- Use GoT to recommend reusable strategies, agents, or flows
- Build at least one reality-facing product/workflow on top of Kingdom

### Success Criteria
- Repeated work becomes faster because the system remembers and reuses it
- At least one real-world product or workflow is built using the Kingdom stack
- The system improves both output quality and decision quality over time

### Dependencies
- Phases 1 through 4

---

## Legacy Track — Minecraft Adapter

Minecraft remains valuable as:

- a constrained proving ground
- a sandbox for agent behavior experiments
- a legacy adapter for testing orchestration patterns in a closed world

It should stay modular and optional.

---

## Immediate Next Moves

1. Complete doctrine rewrite
2. Fix current test failures and restore trust in the suite
3. Formalize the Knowledge Plane contract
4. Redesign Blackboard channels for work and knowledge flow
5. Align `CLAUDE.md` and project agents with the new mission
