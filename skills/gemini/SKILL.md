---
name: gemini
description: Fast Q&A and summarization using Google Gemini. Use for quick strategy questions, summarizing logs, or getting second opinions on agent design.
---

# Gemini Skill

Fast AI assistance via Google Gemini (Phase 5 integration).

## When to Use
- Quick Q&A about Minecraft mechanics
- Summarizing long log files
- Getting alternative strategy suggestions
- Cost-efficient tasks (vs GPT/GLM for complex reasoning)

## Instructions

> **Note**: Gemini integration is planned for Phase 5. Currently a placeholder.

When Phase 5 is implemented:
1. Connect to `bridge:8765` endpoint
2. Route fast queries to Gemini, complex reasoning to GLM-4.7/GPT
3. Cost guardrail: $0.01/attempt max

## Future Integration Points
- `leader.js`: Use Gemini for quick mode decisions
- `safety.js`: Use Gemini for fast threat classification
- Skills library: Use Gemini to generate new skill candidates
