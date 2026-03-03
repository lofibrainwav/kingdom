---
name: mcp-tool-bridge
description: Bridge to external MCP servers. Currently configured: notebooklm. Use to query knowledge bases, search documentation, and connect AI tools.
---

# MCP Tool Bridge Skill

Connects Claude Code to external MCP servers.

## Configured MCP Servers
- **notebooklm**: Query Google NotebookLM (`npx notebooklm-mcp@latest`)

## When to Use
- Querying project knowledge base in NotebookLM
- Phase 5: connecting strategy documents to agent decision-making
- Searching documentation without hallucinations

## Instructions

### NotebookLM
1. Login: "Log me in to NotebookLM"
2. Add notebook: "Add this NotebookLM to my library: [URL]"
3. Query: "What does my notebook say about shelter building strategy?"

### Configuration
MCP servers are configured in `~/.claude/settings.json`:
```json
{
  "mcpServers": {
    "notebooklm": {
      "command": "npx",
      "args": ["-y", "notebooklm-mcp@latest"]
    }
  }
}
```

### Adding New MCP Servers
```json
"new-server": {
  "command": "npx",
  "args": ["-y", "package-name"]
}
```
