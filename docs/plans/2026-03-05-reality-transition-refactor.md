# Kingdom Reality Transition Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reframe `kingdom` from a Minecraft MVP into a real-world agentic operating system grounded in BMAD workflows, shared knowledge, and multi-agent execution.

**Architecture:** Treat documentation as the control plane. First, rewrite the doctrine files so every agent, tool, and future refactor shares the same mission. Then refactor runtime boundaries so Minecraft becomes an origin-story adapter while BMAD, Blackboard, Obsidian, NotebookLM, and GoT become the core system.

**Tech Stack:** Markdown docs, BMAD workflows, Claude Code, Codex, Antigravity, Redis Blackboard, NotebookLM, Obsidian, GoT reasoning modules, Node.js

---

### Task 1: Rewrite the project doctrine

**Files:**
- Create: `docs/kingdom-manifesto.md`
- Modify: `README.md`
- Modify: `README.ko.md`
- Modify: `agent/SOUL.md`

**Step 1: Write the manifesto**

Define:
- origin story
- new mission
- operating principles
- system planes: planning, knowledge, execution, governance

**Step 2: Rewrite the public README**

Document:
- what Kingdom is now
- what infrastructure it uses
- how Minecraft fits as legacy/origin
- what immediate next steps are

**Step 3: Rewrite the Korean README**

Keep it aligned with the English README. Do not add extra promises not present in the English version.

**Step 4: Rewrite `agent/SOUL.md`**

Change the world model from Minecraft to the real world:
- projects instead of coordinates
- capabilities instead of inventory
- trust and verification instead of survival

**Step 5: Verify consistency**

Check that the same mission appears in all four files with no contradictory framing.

### Task 2: Replace the roadmap with a real-world roadmap

**Files:**
- Modify: `ROADMAP.md`
- Modify: `ROADMAP.ko.md`

**Step 1: Define the new phase model**

Use these phases:
1. Doctrine and context reset
2. Knowledge plane
3. Execution plane
4. Governance and observability
5. Product compounding

**Step 2: Preserve legacy context**

Keep Minecraft only as:
- MVP proof
- historical reference
- optional adapter

**Step 3: Add concrete deliverables**

For each phase specify:
- target outcomes
- core files/modules
- success metrics
- dependencies

**Step 4: Add platform-specific intent**

Reference:
- BMAD for planning
- Obsidian + NotebookLM for knowledge
- GoT for reasoning
- Claude Code + Codex + Antigravity for execution
- Redis Blackboard for coordination

**Step 5: Verify bilingual parity**

Ensure `ROADMAP.md` and `ROADMAP.ko.md` describe the same system and same milestones.

### Task 3: Prepare the next refactor wave

**Files:**
- Future modify: `CLAUDE.md`
- Future modify: `agent/interface/mcp-orchestrator.js`
- Future modify: `agent/memory/*.js`
- Future modify: `agent/team/*.js`

**Step 1: Freeze the architectural vocabulary**

Adopt these canonical terms:
- Planning Plane
- Knowledge Plane
- Execution Plane
- Governance Plane
- Origin Story Adapter

**Step 2: Map old modules to new roles**

Examples:
- `pm-agent` -> work intake and decomposition
- `swarm-orchestrator` -> execution dispatch
- `skill-zettelkasten` + `got-reasoner` -> knowledge graph and reasoning core
- `vault-sync` -> Obsidian sync bridge

**Step 3: Define first runtime refactor**

Plan to introduce:
- `work:*` Blackboard channels
- `knowledge:*` Blackboard channels
- `governance:*` Blackboard channels

**Step 4: Define test baseline**

Before runtime refactors:
- fix current failing tests
- preserve green baseline
- add tests for new channel naming and orchestration boundaries

### Task 4: Verification and handoff

**Files:**
- Modify: `docs/plans/2026-03-05-reality-transition-refactor.md`
- Optional create: `docs/adr/ADR-001-reality-transition.md`

**Step 1: Run document review**

Check for:
- old Minecraft-only phrasing
- OpenClaw-only assumptions
- missing references to BMAD / NotebookLM / Obsidian / GoT

**Step 2: Record the architectural decision**

Write ADR:
- Kingdom is a real-world system
- Minecraft is origin story, not product boundary

**Step 3: Begin implementation in a new branch/worktree**

After doctrine is merged:
- fix tests
- refactor runtime channels
- align CLAUDE rules and agent prompts

