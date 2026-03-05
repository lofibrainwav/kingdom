# ADR-001: Kingdom Reality Transition

**Status**: Accepted

## Context

Kingdom began as a Minecraft MVP that proved agent coordination, shared memory, and skill compounding in a closed world.

The repository has since evolved far beyond that original scope. It now contains BMAD planning assets, shared memory systems, reasoning modules, agent orchestration, NotebookLM and Obsidian integrations, and multiple execution surfaces such as Claude Code, Codex, and Antigravity.

The old framing no longer describes the real system truthfully.

## Decision

Kingdom is now defined as a real-world agentic operating system.

Minecraft is retained only as:

- origin story
- proof-of-concept history
- optional sandbox adapter

The system is organized around four planes:

- Planning Plane
- Knowledge Plane
- Execution Plane
- Governance Plane

## Consequences

### Positive

- Core documents can finally describe the real mission
- Future refactors have a stable architectural vocabulary
- Knowledge systems become first-class citizens instead of side integrations
- Execution tools can be aligned around shared work instead of a legacy game loop

### Negative

- Legacy prompts, skills, and docs will need follow-up cleanup
- Some naming and runtime assumptions remain temporarily inconsistent
- Existing contributors will need to internalize the new framing

## Alternatives Considered

### Keep Kingdom defined as a Minecraft system

Rejected because it no longer matches the repository's actual capabilities or intended future.

### Split into two repositories immediately

Rejected for now because the current value lies in preserving continuity while gradually isolating the Minecraft adapter.

## Follow-Up

1. Align `CLAUDE.md` and `.claude` agents/skills with the new mission
2. Restore a green test baseline
3. Refactor Blackboard channels around work, knowledge, and governance
4. Formalize Obsidian, NotebookLM, and GoT contracts
