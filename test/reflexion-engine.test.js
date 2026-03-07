const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { ReflexionEngine, _getDefaultConfig, parseLLMJson } = require('../agent/core/ReflexionEngine');

describe('ReflexionEngine', () => {
  let configs;
  let published;
  let board;
  let engine;

  beforeEach(() => {
    configs = new Map();
    published = [];

    board = {
      connect: async () => {},
      disconnect: async () => {},
      getConfig: async (key) => configs.get(key) || null,
      setConfig: async (key, value) => { configs.set(key, value); },
      publish: async (ch, data) => { published.push({ ch, data }); },
    };
  });

  it('initializes with default config', () => {
    engine = new ReflexionEngine({});
    engine.board = board;
    assert.deepStrictEqual(engine.config, _getDefaultConfig());
    assert.equal(engine.dailyCost, 0);
    assert.equal(engine.totalCalls, 0);
  });

  it('reloadConfig merges from Redis', async () => {
    configs.set('config:llm', { temperature: 0.9 });
    engine = new ReflexionEngine({});
    engine.board = board;
    await engine.reloadConfig();
    assert.equal(engine.config.temperature, 0.9);
    // Original fields preserved
    assert.equal(engine.config.maxTokens, _getDefaultConfig().maxTokens);
  });

  it('saveConfig persists and publishes', async () => {
    engine = new ReflexionEngine({});
    engine.board = board;
    await engine.saveConfig({ temperature: 0.5 });
    assert.equal(engine.config.temperature, 0.5);
    assert.ok(configs.has('config:llm'));
    assert.equal(published.length, 1);
    assert.equal(published[0].ch, 'config:llm:updated');
  });

  it('callLLM routes to local client for local: prefix', async () => {
    let calledWith = null;
    const mockClients = {
      local: { call: async (model, prompt) => { calledWith = { model, prompt }; return 'ok'; } },
    };
    engine = new ReflexionEngine(mockClients);
    engine.board = board;
    engine.config.model = 'local:test-model';
    engine.config.maxCostPerDay = 100;

    const result = await engine.callLLM('test prompt');
    assert.equal(result, 'ok');
    assert.equal(calledWith.model, 'test-model');
    assert.equal(engine.totalCalls, 1);
  });

  it('callLLM routes to groq client for groq: prefix', async () => {
    let calledModel = null;
    const mockClients = {
      groq: { call: async (model) => { calledModel = model; return 'groq-ok'; } },
    };
    engine = new ReflexionEngine(mockClients);
    engine.board = board;
    engine.config.model = 'groq:llama-3';
    engine.config.maxCostPerDay = 100;

    const result = await engine.callLLM('prompt');
    assert.equal(result, 'groq-ok');
    assert.equal(calledModel, 'llama-3');
  });

  it('callLLM falls back on primary failure', async () => {
    const calls = [];
    const mockClients = {
      local: { call: async () => { throw new Error('down'); } },
      groq: { call: async (_model, _prompt) => { calls.push('groq'); return 'fallback-ok'; } },
    };
    engine = new ReflexionEngine(mockClients);
    engine.board = board;
    engine.config.model = 'local:broken';
    engine.config.fallbackModel = 'groq:backup';
    engine.config.maxCostPerDay = 100;

    const result = await engine.callLLM('prompt');
    assert.equal(result, 'fallback-ok');
    assert.deepStrictEqual(calls, ['groq']);
  });

  it('callLLM returns null when all clients fail', async () => {
    const mockClients = {
      local: { call: async () => { throw new Error('down'); } },
      groq: { call: async () => { throw new Error('also down'); } },
    };
    engine = new ReflexionEngine(mockClients);
    engine.board = board;
    engine.config.model = 'local:broken';
    engine.config.fallbackModel = 'groq:broken';
    engine.config.maxCostPerDay = 100;

    const result = await engine.callLLM('prompt');
    assert.equal(result, null);
  });

  it('callLLM returns null when daily cost limit reached', async () => {
    engine = new ReflexionEngine({});
    engine.board = board;
    engine.config.maxCostPerDay = 0;
    engine.dailyCost = 0;

    const result = await engine.callLLM('prompt');
    assert.equal(result, null);
  });

  it('callLLM uses escalationModel for critical severity', async () => {
    let calledModel = null;
    const mockClients = {
      local: { call: async (model) => { calledModel = model; return 'ok'; } },
    };
    engine = new ReflexionEngine(mockClients);
    engine.board = board;
    engine.config.model = 'local:normal';
    engine.config.escalationModel = 'local:critical';
    engine.config.maxCostPerDay = 100;

    await engine.callLLM('prompt', 'critical');
    assert.equal(calledModel, 'critical');
  });

  it('generateSkill parses JSON from LLM response', async () => {
    const mockClients = {
      local: { call: async () => '{"name":"test","code":"x=1","description":"test","errorType":"e"}' },
    };
    engine = new ReflexionEngine(mockClients);
    engine.board = board;
    engine.config.model = 'local:m';
    engine.config.maxCostPerDay = 100;

    const result = await engine.generateSkill({ error: 'test' });
    assert.equal(result.name, 'test');
    assert.equal(result.code, 'x=1');
  });

  it('generateSkill returns null on invalid JSON', async () => {
    const mockClients = {
      local: { call: async () => 'not json at all' },
    };
    engine = new ReflexionEngine(mockClients);
    engine.board = board;
    engine.config.model = 'local:m';
    engine.config.maxCostPerDay = 100;

    const result = await engine.generateSkill({ error: 'test' });
    assert.equal(result, null);
  });

  it('getStats returns accurate counters', async () => {
    const mockClients = {
      local: { call: async () => 'ok' },
    };
    engine = new ReflexionEngine(mockClients);
    engine.board = board;
    engine.config.model = 'local:m';
    engine.config.maxCostPerDay = 100;

    await engine.callLLM('a');
    await engine.callLLM('b');
    const stats = engine.getStats();
    assert.equal(stats.totalCalls, 2);
    assert.equal(stats.modelUsage['local:m'], 2);
  });

  it('parseLLMJson strips <think> blocks from reasoning models', () => {
    const response = '<think>Let me analyze this... The user wants JSON.</think>\n{"name":"hello","code":"return 1"}';
    const result = parseLLMJson(response);
    assert.equal(result.name, 'hello');
    assert.equal(result.code, 'return 1');
  });

  it('parseLLMJson handles nested <think> with JSON-like content', () => {
    const response = '<think>I should return {"wrong": true} but actually...</think>{"correct": true}';
    const result = parseLLMJson(response);
    assert.equal(result.correct, true);
    assert.equal(result.wrong, undefined);
  });

  it('parseLLMJson works without <think> blocks', () => {
    const result = parseLLMJson('Here is the result: {"tasks": [1,2,3]}');
    assert.deepEqual(result.tasks, [1, 2, 3]);
  });

  it('parseLLMJson returns object directly if already parsed', () => {
    const obj = { already: 'parsed' };
    assert.equal(parseLLMJson(obj), obj);
  });

  it('shutdown disconnects board', async () => {
    let disconnected = false;
    engine = new ReflexionEngine({});
    engine.board = { ...board, disconnect: async () => { disconnected = true; } };
    await engine.shutdown();
    assert.equal(disconnected, true);
  });
});
