---
name: cost-aware-llm-pipeline
description: Use when implementing or reviewing LLM API calls, model routing, caching, retries, or budget controls so Kingdom keeps quality high without wasting credits.
---

# Cost-Aware LLM Pipeline

## Purpose
Optimize API costs through intelligent model routing, prompt caching, and retry strategies.
Reference for API cost optimization and model routing decisions.

## When to Use

- Adding new LLM API calls
- Reviewing prompt cost or routing decisions
- Debugging credit spikes or rate-limit behavior
- Planning batch inference work
- Choosing the cheapest viable model for a task

## Model Routing Strategy

### Tier Selection
| Task | Model | Cost |
|------|-------|------|
| Simple classification, formatting | haiku | $0.25/MTok |
| Code generation, analysis | sonnet | $3/MTok |
| Complex reasoning, architecture | opus | $15/MTok |

### Decision Flow
```
1. Estimate task complexity (tokens + reasoning depth)
2. Start with cheapest viable model
3. Escalate on failure or insufficient quality
4. Cache successful prompts for reuse
```

## Prompt Caching
- Use `cache_control: { type: "ephemeral" }` for system prompts >1024 tokens
- Cache hit = 90% cost reduction
- Group related API calls to maximize cache window (5-minute TTL)

## Retry Strategy
```
attempt 1: haiku  (if task is simple)
attempt 2: sonnet (if haiku fails or quality insufficient)
attempt 3: opus   (final escalation)
```

- Exponential backoff: 1s, 2s, 4s
- Rate limit: respect `retry-after` header
- Budget cap: set `max_cost_per_call` in config

## Octiv Integration

### `agent/ReflexionEngine.js` — Model Chain
```
Primary:    claude-haiku-4-5-20251001   (normal severity)
Escalation: claude-sonnet-4-5-20241022  (critical severity)
Fallback:   local:qwen/qwen3.5-9b       (LM Studio @ localhost:1234, 13.4 tok/s)
Last resort: _fallbackSkill()            (hardcoded safe response)
```

### `agent/api-clients.js` — Client Factory
```javascript
// Clients created by createApiClients():
// - anthropic: requires ANTHROPIC_API_KEY (cloud, paid)
// - local: always created (LM Studio, free, 60s timeout)
// - groq: requires GROQ_API_KEY (cloud, optional)
```

### Cost Tracking
- Log each API call: `{ model, input_tokens, output_tokens, cost }`
- Daily budget alert at 80% threshold
- Session summary: total calls, total cost, cache hit rate

## Implementation

- Start with the cheapest viable model.
- Escalate only when quality or task complexity requires it.
- Cache repeated long prompts whenever possible.
- Track cost, retries, and failure reasons in logs or telemetry.

## Anti-Patterns
- Never use opus for simple yes/no classification
- Never retry the same model on rate limit (backoff instead)
- Never skip caching for repeated system prompts
- Never hardcode model IDs — use config constants
