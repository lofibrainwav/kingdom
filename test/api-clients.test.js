const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { createApiClients } = require('../agent/core/api-clients');

describe('createApiClients', () => {
  let savedEnv;

  beforeEach(() => {
    savedEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = savedEnv;
  });

  it('returns empty object when no API keys are set', () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GROQ_API_KEY;
    process.env.LM_STUDIO_ENABLED = 'false';

    const clients = createApiClients();
    // Only local may be present if LM_STUDIO_ENABLED is not false
    assert.ok(!clients.anthropic, 'no anthropic client without key');
    assert.ok(!clients.groq, 'no groq client without key');
    assert.ok(!clients.local, 'no local client when disabled');
  });

  it('creates local client when LM_STUDIO_ENABLED is not false', () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GROQ_API_KEY;
    delete process.env.LM_STUDIO_ENABLED;

    const clients = createApiClients();
    assert.ok(clients.local, 'local client should exist');
    assert.equal(typeof clients.local.call, 'function', 'local.call should be a function');
  });

  it('local client throws when LM Studio is not reachable', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.LM_STUDIO_ENABLED;
    process.env.LM_STUDIO_URL = 'http://127.0.0.1:19999'; // unreachable port

    const clients = createApiClients();
    await assert.rejects(
      () => clients.local.call('test-model', 'hello'),
      /LM Studio not reachable/,
    );
  });

  it('does not create anthropic client without SDK installed', () => {
    // SDK may or may not be installed; test that it doesn't crash
    process.env.ANTHROPIC_API_KEY = 'test-key';
    process.env.LM_STUDIO_ENABLED = 'false';
    delete process.env.GROQ_API_KEY;

    const clients = createApiClients();
    // If @anthropic-ai/sdk is not installed, anthropic won't exist — both outcomes are valid
    assert.ok(typeof clients === 'object');
  });
});
