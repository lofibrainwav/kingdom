# Skill Quality Contract

Kingdom keeps its own skill creation system. We do not need to replace it with an external plugin, but we do need a stronger evaluation loop.

## Goal

Treat skills as measurable assets, not just handwritten guidance.

## Current Evaluation Scope

Phase 1 uses structural evaluation through `SkillEvaluator`.

Each skill is checked for:

- valid `SKILL.md`
- frontmatter with `name` and `description`
- description that starts with `Use when`
- `SKILL.md` length under 500 lines
- `When to Use` section
- at least one `Reference`, `References`, or `Implementation` section

## Canonical Event

- `knowledge:skill:eval-completed`

This event records that a skill evaluation ran and produced a score.

## Why This Helps

Our current system is already strong at:

- creating project-specific skills
- updating skills as the codebase changes
- recording workflows into reusable memory

What was missing was a repeatable quality signal.

`SkillEvaluator` provides the first baseline:

- detect drift
- score skills consistently
- publish eval results into the Knowledge Plane

## What This Is Not Yet

This is not a full behavioral benchmark.

Future phases should add:

- prompt fixtures
- pass/fail behavioral evals
- version-to-version comparisons
- token/time benchmarking

## Operating Rule

Use the structural eval loop now.

Do not block on full benchmark infrastructure before improving the skill library.
