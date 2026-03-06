# Kingdom Agent Operating Model

## Purpose

This document explains how Kingdom should operate in practice so the system can improve through repeated real use, not just isolated implementation bursts.

## The Four Planes

### Planning Plane
- Convert goals into briefs, plans, PRDs, stories, and checkpoints
- Use BMAD as the default operating grammar

### Knowledge Plane
- Store working memory in Obsidian
- Store grounded sources in NotebookLM
- Connect patterns, skills, failures, and decisions through GoT
- Use `KnowledgeOperator` to turn validated milestones into durable notes and reusable patterns

### Execution Plane
- Use Claude Code, Codex, Antigravity, and local agents to perform work
- Coordinate through Blackboard and explicit artifacts
- Use `TaskRunner` to prepare deterministic task workspaces and lifecycle state

### Governance Plane
- Verify, review, and measure before claiming success
- Keep risky actions inside clear approval boundaries

## Default Work Loop

1. Clarify the goal
2. Retrieve context
3. Plan the work
4. Execute serially or in parallel
5. Verify the outcome
6. Capture the lesson
7. Reuse the lesson next time

## Serial vs Parallel

### Prefer serial execution when:
- dependencies are tight
- the task changes shared architecture
- the result of one step determines the next

### Prefer parallel execution when:
- workstreams are independent
- one track is research and another is implementation
- review can happen after merge of outputs

## What Counts As Experience

Experience is not just elapsed work. It is validated learning.

Capture experience when:
- a workflow works in practice
- a bug pattern repeats
- a planning assumption proves correct or false
- a coordination protocol reduces confusion
- a retrieval pattern improves agent performance

## What Must Be Preserved

- decisions
- reusable workflows
- bug-to-fix mappings
- verification checklists
- successful orchestration patterns

If the next generation cannot reuse it, it was not preserved well enough.
