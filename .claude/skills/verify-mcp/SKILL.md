---
name: verify-mcp
description: Use when MCP setup changes, a tool appears unavailable, or you need to confirm server configuration and token readiness across global and project scopes.
---

# verify-mcp

Verify MCP server configurations and token availability.

## When to Use

- An MCP tool is missing or failing unexpectedly
- `.mcp.json` or global Claude settings changed
- New tokens were added or rotated
- You need a readiness check before using project MCP workflows

## Steps

1. **Global MCP** — Read `~/.claude/settings.json`:
   - Check `mcpServers` section
   - For each server: verify command exists, check args
   - Expected: `context7`, `sequentialthinking`, `playwright`

2. **Project MCP** — Read `.mcp.json`:
   - Check each server definition
   - Expected: `github`, `figma`, `supabase`, `vercel`, `sentry`, `serena`, `filesystem`, `memory`
   - For servers with env var tokens: verify the env var is defined in `.env`

3. **Token check** — For each MCP requiring auth:
   | MCP | Env Var | Required |
   |-----|---------|----------|
   | github | GITHUB_TOKEN | Yes |
   | figma | FIGMA_TOKEN | No (read-only features) |
   | supabase | SUPABASE_ACCESS_TOKEN | When using DB |
   | vercel | VERCEL_TOKEN | When deploying |
   | sentry | SENTRY_AUTH_TOKEN | When debugging |

4. **Report format**:
```
## MCP Status Report

### Global MCP Servers
| Server | Status | Notes |
|--------|--------|-------|
| context7 | ✅ Active | Library docs |
| sequentialthinking | ✅ Active | Multi-step reasoning |
| playwright | ✅ Active / 🔧 Setup Needed | Browser automation |

### Project MCP Servers
| Server | Status | Notes |
|--------|--------|-------|
| github | ✅ Active | GITHUB_TOKEN present |
| serena | ✅ Active | Local LSP, no token needed |
| figma | ⚠️ Token Required | FIGMA_TOKEN not in .env |
| supabase | ⚠️ Token Required | SUPABASE_ACCESS_TOKEN not in .env |
| vercel | ⚠️ Token Required | VERCEL_TOKEN not in .env |
| sentry | ⚠️ Token Required | SENTRY_AUTH_TOKEN not in .env |

### Summary
- Active: N/M
- Token Required: N
- Setup Needed: N
```

## Implementation

1. Check global MCP registrations first.
2. Check project-specific MCP configuration second.
3. Verify only token presence, not token values.
4. Report which servers are ready, blocked, or optional.
