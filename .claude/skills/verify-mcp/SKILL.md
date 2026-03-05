---
name: verify-mcp
description: Verify MCP server configurations and token availability across global (~/.claude/settings.json) and project (.mcp.json) scopes. Checks expected servers and env var presence.
---

# verify-mcp

Verify MCP server configurations and token availability.

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
