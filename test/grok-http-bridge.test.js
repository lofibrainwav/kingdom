/**
 * Smoke tests for grok-mcp HTTP bridge (http-server.mjs).
 *
 * These tests spin up the HTTP server in a child process and verify
 * the endpoint contract that HttpMcpClient depends on.
 * Chrome/CDP is NOT required — we test error paths gracefully.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

const HTTP_SERVER_PATH = path.resolve(__dirname, '../../mcp-servers/grok-mcp/http-server.mjs');
const TEST_PORT = 3199;
const BASE = `http://localhost:${TEST_PORT}`;

let proc;

async function waitForServer(url, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await fetch(url);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error(`Server did not start within ${timeoutMs}ms`);
}

describe('grok-http-bridge', () => {
  before(async () => {
    proc = spawn('node', [HTTP_SERVER_PATH], {
      env: { ...process.env, PORT: String(TEST_PORT) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    // Collect stderr for debugging if needed
    proc.stderr.on('data', () => {});
    await waitForServer(`${BASE}/health`);
  });

  after(() => {
    if (proc) {
      proc.kill('SIGTERM');
      proc = null;
    }
  });

  it('GET /health returns ok (browser may be false without Chrome)', async () => {
    const res = await fetch(`${BASE}/health`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(typeof data.browser, 'boolean');
  });

  it('POST /ask with missing question returns 400', async () => {
    const res = await fetch(`${BASE}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(data.error.includes('question'), true, 'error should mention question');
  });

  it('POST /ask with invalid JSON returns 400', async () => {
    const res = await fetch(`${BASE}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(typeof data.error, 'string', 'should return error string');
  });

  it('POST /ask with valid question returns 502 when Chrome unavailable', async () => {
    const res = await fetch(`${BASE}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: 'test question' }),
    });
    // Without Chrome/CDP, we expect 502 (browser connection failure)
    assert.equal([502, 503].includes(res.status), true, `Expected 502 or 503, got ${res.status}`);
    const data = await res.json();
    assert.equal(typeof data.error, 'string', 'should return error string');
  });

  it('GET /unknown returns 404', async () => {
    const res = await fetch(`${BASE}/unknown`);
    assert.equal(res.status, 404);
  });
});
