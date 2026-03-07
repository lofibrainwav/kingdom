/**
 * MCP Client Factory — Phase 5.3
 * Creates client adapters for external MCP services (Grok, NotebookLM).
 *
 * Each client exposes a unified { askQuestion(question) } interface.
 * Environment-driven: no env vars → returns null (graceful degradation).
 *
 * Env vars:
 *   GROK_MCP_URL  — HTTP endpoint for Grok MCP (e.g. http://localhost:3100/ask)
 *   NLM_MCP_URL   — HTTP endpoint for NotebookLM MCP (e.g. http://localhost:3200/ask)
 */
const { getLogger } = require('../core/logger');
const log = getLogger();

class HttpMcpClient {
  constructor(name, baseUrl) {
    this.name = name;
    this.baseUrl = baseUrl;
  }

  async askQuestion(question) {
    const res = await fetch(this.baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question }),
    });
    if (!res.ok) {
      throw new Error(`${this.name} MCP returned ${res.status}`);
    }
    const data = await res.json();
    return data.answer || data.result || JSON.stringify(data);
  }
}

function createMcpClients() {
  const clients = { grokClient: null, nlmClient: null };

  const grokUrl = process.env.GROK_MCP_URL;
  if (grokUrl) {
    clients.grokClient = new HttpMcpClient('Grok', grokUrl);
    log.info('mcp-client-factory', `Grok client ready: ${grokUrl}`);
  } else {
    log.info('mcp-client-factory', 'GROK_MCP_URL not set — Grok client disabled');
  }

  const nlmUrl = process.env.NLM_MCP_URL;
  if (nlmUrl) {
    clients.nlmClient = new HttpMcpClient('NotebookLM', nlmUrl);
    log.info('mcp-client-factory', `NotebookLM client ready: ${nlmUrl}`);
  } else {
    log.info('mcp-client-factory', 'NLM_MCP_URL not set — NotebookLM client disabled');
  }

  return clients;
}

module.exports = { createMcpClients, HttpMcpClient };
