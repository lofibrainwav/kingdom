const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { createMcpClients, HttpMcpClient } = require('../agent/memory/mcp-client-factory');

describe('createMcpClients', () => {
  let origGrok;
  let origNlm;

  beforeEach(() => {
    origGrok = process.env.GROK_MCP_URL;
    origNlm = process.env.NLM_MCP_URL;
    delete process.env.GROK_MCP_URL;
    delete process.env.NLM_MCP_URL;
  });

  afterEach(() => {
    if (origGrok !== undefined) process.env.GROK_MCP_URL = origGrok;
    else delete process.env.GROK_MCP_URL;
    if (origNlm !== undefined) process.env.NLM_MCP_URL = origNlm;
    else delete process.env.NLM_MCP_URL;
  });

  it('returns null clients when no env vars set', () => {
    const { grokClient, nlmClient } = createMcpClients();
    assert.equal(grokClient, null);
    assert.equal(nlmClient, null);
  });

  it('creates Grok client when GROK_MCP_URL is set', () => {
    process.env.GROK_MCP_URL = 'http://localhost:3100/ask';
    const { grokClient, nlmClient } = createMcpClients();
    assert.ok(grokClient instanceof HttpMcpClient);
    assert.equal(grokClient.name, 'Grok');
    assert.equal(grokClient.baseUrl, 'http://localhost:3100/ask');
    assert.equal(nlmClient, null);
  });

  it('creates NLM client when NLM_MCP_URL is set', () => {
    process.env.NLM_MCP_URL = 'http://localhost:3200/ask';
    const { grokClient, nlmClient } = createMcpClients();
    assert.equal(grokClient, null);
    assert.ok(nlmClient instanceof HttpMcpClient);
    assert.equal(nlmClient.name, 'NotebookLM');
  });

  it('creates both clients when both env vars set', () => {
    process.env.GROK_MCP_URL = 'http://grok:3100/ask';
    process.env.NLM_MCP_URL = 'http://nlm:3200/ask';
    const { grokClient, nlmClient } = createMcpClients();
    assert.equal(grokClient instanceof HttpMcpClient, true, 'grokClient should be HttpMcpClient instance');
    assert.equal(nlmClient instanceof HttpMcpClient, true, 'nlmClient should be HttpMcpClient instance');
  });
});

describe('HttpMcpClient', () => {
  it('askQuestion sends POST and returns answer field', async () => {
    const client = new HttpMcpClient('Test', 'http://test/ask');
    const origFetch = global.fetch;
    global.fetch = async (url, opts) => {
      assert.equal(url, 'http://test/ask');
      assert.equal(opts.method, 'POST');
      const body = JSON.parse(opts.body);
      assert.equal(body.question, 'What is Redis?');
      return { ok: true, json: async () => ({ answer: 'A key-value store' }) };
    };

    const result = await client.askQuestion('What is Redis?');
    global.fetch = origFetch;
    assert.equal(result, 'A key-value store');
  });

  it('askQuestion falls back to result field', async () => {
    const client = new HttpMcpClient('Test', 'http://test/ask');
    const origFetch = global.fetch;
    global.fetch = async () => ({
      ok: true,
      json: async () => ({ result: 'fallback result' }),
    });

    const result = await client.askQuestion('test');
    global.fetch = origFetch;
    assert.equal(result, 'fallback result');
  });

  it('askQuestion throws on non-ok response', async () => {
    const client = new HttpMcpClient('Grok', 'http://test/ask');
    const origFetch = global.fetch;
    global.fetch = async () => ({ ok: false, status: 503 });

    await assert.rejects(
      () => client.askQuestion('test'),
      (err) => err.message.includes('503')
    );
    global.fetch = origFetch;
  });

  it('askQuestion stringifies response when no answer/result field', async () => {
    const client = new HttpMcpClient('Test', 'http://test/ask');
    const origFetch = global.fetch;
    global.fetch = async () => ({
      ok: true,
      json: async () => ({ data: 'raw' }),
    });

    const result = await client.askQuestion('test');
    global.fetch = origFetch;
    assert.equal(result.includes('raw'), true, 'stringified response should contain raw data');
  });
});
