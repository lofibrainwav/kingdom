const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { SkillPipeline, getDailyLimit } = require('../agent/memory/skill-pipeline');

describe('SkillPipeline', () => {
  let configs;
  let skills;
  let published;
  let board;
  let pipeline;

  beforeEach(() => {
    configs = new Map();
    skills = new Map();
    published = [];

    board = {
      connect: async () => {},
      disconnect: async () => {},
      getConfig: async (key) => configs.get(key) || null,
      setConfig: async (key, value) => { configs.set(key, value); },
      publish: async (ch, data) => { published.push({ ch, data }); },
      saveSkill: async (name, entry) => { skills.set(name, JSON.stringify(entry)); },
      getSkill: async (name) => {
        const raw = skills.get(name);
        return raw ? JSON.parse(raw) : null;
      },
      getHash: async () => {
        const result = {};
        for (const [k, v] of skills) result[k] = v;
        return result;
      },
      deleteHashField: async (hash, field) => { skills.delete(field); },
    };
  });

  function createPipeline(llmClient = null) {
    pipeline = new SkillPipeline(llmClient);
    pipeline.board = board;
    return pipeline;
  }

  it('initializes with zero daily count', () => {
    createPipeline();
    assert.equal(pipeline.dailyCount, 0);
  });

  it('init loads daily count from Redis', async () => {
    configs.set('skills:daily_meta', { count: 3, resetAt: Date.now() + 999999 });
    createPipeline();
    await pipeline.init();
    assert.equal(pipeline.dailyCount, 3);
  });

  it('init resets daily count if reset time has passed', async () => {
    configs.set('skills:daily_meta', { count: 3, resetAt: Date.now() - 1000 });
    createPipeline();
    await pipeline.init();
    assert.equal(pipeline.dailyCount, 0);
  });

  it('generateFromFailure returns daily_limit_reached when exhausted', async () => {
    createPipeline();
    pipeline.dailyCount = getDailyLimit();
    const result = await pipeline.generateFromFailure({ error: 'test' });
    assert.equal(result.success, false);
    assert.equal(result.reason, 'daily_limit_reached');
  });

  it('generateFromFailure uses fallback when no LLM client', async () => {
    createPipeline(null);
    const result = await pipeline.generateFromFailure({ error: 'test', errorType: 'timeout' });
    assert.equal(result.success, true);
    assert.match(result.skill, /fallback_timeout/);
    assert.equal(pipeline.dailyCount, 1);
    assert.equal(published.length, 1);
    assert.equal(published[0].ch, 'knowledge:skills:deployed');
  });

  it('generateFromFailure uses LLM client when provided', async () => {
    const mockLLM = {
      generateSkill: async () => ({
        name: 'llm_skill_v1',
        code: 'const x = 1;',
        description: 'from LLM',
        errorType: 'test',
      }),
    };
    createPipeline(mockLLM);
    const result = await pipeline.generateFromFailure({ error: 'test' });
    assert.equal(result.success, true);
    assert.equal(result.skill, 'llm_skill_v1');
  });

  it('generateFromFailure returns invalid_skill_json for bad LLM output', async () => {
    const mockLLM = { generateSkill: async () => ({ name: 'no-code' }) };
    createPipeline(mockLLM);
    const result = await pipeline.generateFromFailure({ error: 'test' });
    assert.equal(result.success, false);
    assert.equal(result.reason, 'invalid_skill_json');
  });

  it('validateSkill passes safe code', async () => {
    createPipeline();
    const valid = await pipeline.validateSkill('const x = 1 + 2;');
    assert.equal(valid, true);
  });

  it('validateSkill rejects code that throws', async () => {
    createPipeline();
    const valid = await pipeline.validateSkill('throw new Error("boom");');
    assert.equal(valid, false);
  });

  it('validateSkill blocks require in sandbox', async () => {
    createPipeline();
    const valid = await pipeline.validateSkill('require("child_process")');
    assert.equal(valid, false);
  });

  it('validateSkill blocks process in sandbox', async () => {
    createPipeline();
    const valid = await pipeline.validateSkill('process.exit(1)');
    assert.equal(valid, false);
  });

  it('deploySkill saves to library with metadata', async () => {
    createPipeline();
    const entry = await pipeline.deploySkill({ name: 'test_skill', code: 'x=1' });
    assert.equal(entry.successRate, 1.0);
    assert.equal(entry.uses, 0);
    assert.ok(skills.has('test_skill'));
  });

  it('updateSuccessRate tracks usage correctly', async () => {
    createPipeline();
    await pipeline.deploySkill({ name: 's1', code: 'x=1' });

    await pipeline.updateSuccessRate('s1', true);
    await pipeline.updateSuccessRate('s1', true);
    const result = await pipeline.updateSuccessRate('s1', true);
    assert.equal(result.discarded, false);
    assert.equal(result.rate, 1.0);
  });

  it('updateSuccessRate discards low-performing skill after 3+ uses', async () => {
    createPipeline();
    await pipeline.deploySkill({ name: 's2', code: 'x=1' });

    await pipeline.updateSuccessRate('s2', false);
    await pipeline.updateSuccessRate('s2', false);
    const result = await pipeline.updateSuccessRate('s2', false);
    assert.equal(result.discarded, true);
    assert.ok(!skills.has('s2'), 'skill should be removed from library');
  });

  it('updateSuccessRate returns null for unknown skill', async () => {
    createPipeline();
    const result = await pipeline.updateSuccessRate('nonexistent', true);
    assert.equal(result, null);
  });

  it('getLibrary returns all deployed skills', async () => {
    createPipeline();
    await pipeline.deploySkill({ name: 'a', code: '1' });
    await pipeline.deploySkill({ name: 'b', code: '2' });
    const lib = await pipeline.getLibrary();
    assert.equal(lib.a.code, '1', 'library should contain skill a');
    assert.equal(lib.b.code, '2', 'library should contain skill b');
  });

  it('shutdown disconnects board', async () => {
    let disconnected = false;
    createPipeline();
    pipeline.board = { ...board, disconnect: async () => { disconnected = true; } };
    await pipeline.shutdown();
    assert.equal(disconnected, true, 'board should be disconnected on shutdown');
  });
});
