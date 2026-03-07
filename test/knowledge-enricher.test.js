/**
 * KnowledgeEnricher Unit Tests
 *
 * Tests that prompts get enriched with ZK skills, research, and rumination context.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');
const fs = require('fs');

const { KnowledgeEnricher } = require('../agent/core/knowledge-enricher');
const { SkillZettelkasten } = require('../agent/memory/skill-zettelkasten');
const { Blackboard } = require('../agent/core/blackboard');

const TEST_ZK_PREFIX = 'test-enricher-zk';
const TEMP_VAULT = path.join(os.tmpdir(), `kingdom-enricher-test-${Date.now()}`);

async function cleanKeys(board) {
  const client = board.client;
  const keys = await client.keys(`kingdom:${TEST_ZK_PREFIX}:*`);
  if (keys.length > 0) await client.del(keys);
  const configKeys = await client.keys(`kingdom:config:${TEST_ZK_PREFIX}:*`);
  if (configKeys.length > 0) await client.del(configKeys);
}

describe('KnowledgeEnricher', () => {
  let board, zk, enricher;

  before(async () => {
    fs.mkdirSync(TEMP_VAULT, { recursive: true });
    board = new Blackboard();
    await board.connect();
    await cleanKeys(board);
    zk = new SkillZettelkasten({ board, vaultDir: TEMP_VAULT, zkPrefix: TEST_ZK_PREFIX });
    await zk.init();
    enricher = new KnowledgeEnricher({ zk, board, maxContextChars: 1000 });
  });

  after(async () => {
    await cleanKeys(board);
    await board.disconnect();
    fs.rmSync(TEMP_VAULT, { recursive: true, force: true });
  });

  it('returns raw prompt when no knowledge available', async () => {
    const prompt = 'Write a hello world function';
    const result = await enricher.enrich(prompt, {});
    assert.equal(result, prompt);
  });

  it('enriches prompt with ZK skill context', async () => {
    // Seed a skill
    await zk.createNote({
      name: 'Test Enrich Skill',
      errorType: 'syntax',
    });
    // Record usage to build up stats
    for (let i = 0; i < 5; i++) await zk.recordUsage('test-enrich-skill', true, {});

    enricher.invalidateCache();
    const result = await enricher.enrich('Fix syntax error', { errorType: 'syntax' });
    assert.ok(result.includes('[KNOWLEDGE CONTEXT]'));
    assert.ok(result.includes('test-enrich-skill'));
    assert.ok(result.includes('[END CONTEXT]'));
    assert.ok(result.includes('Fix syntax error'));
  });

  it('enriches with top XP skills when no errorType match', async () => {
    enricher.invalidateCache();
    const result = await enricher.enrich('Generic task', { errorType: 'nonexistent-type' });
    // Should fall back to top-XP skills
    assert.ok(result.includes('[KNOWLEDGE CONTEXT]'));
    assert.ok(result.includes('test-enrich-skill'));
  });

  it('respects maxContextChars budget', async () => {
    const smallEnricher = new KnowledgeEnricher({ zk, board, maxContextChars: 50 });
    smallEnricher.invalidateCache();
    const result = await smallEnricher.enrich('Task', { errorType: 'syntax' });
    // Context block should be trimmed
    const contextBlock = result.split('[END CONTEXT]')[0];
    assert.ok(contextBlock.includes('...'));
  });

  it('works without zk (no crash, returns raw prompt)', async () => {
    const noZkEnricher = new KnowledgeEnricher({ zk: null, board });
    const result = await noZkEnricher.enrich('Test prompt', { errorType: 'logic' });
    assert.equal(result, 'Test prompt');
  });

  it('includes rumination notes when available', async () => {
    await zk.createNote({
      name: 'Ruminated Skill',
      errorType: 'runtime',
    });
    for (let i = 0; i < 5; i++) await zk.recordUsage('ruminated-skill', true, {});
    // Manually inject rumination note via Redis
    const note = await zk.getNote('ruminated-skill');
    note.ruminationNotes = [{ insight: 'Always check null before access', digestedAt: Date.now() }];
    await board.client.hSet(`kingdom:${TEST_ZK_PREFIX}:notes`, 'ruminated-skill', JSON.stringify(note));

    enricher.invalidateCache();
    const result = await enricher.enrich('Fix runtime error', { errorType: 'runtime' });
    assert.ok(result.includes('Rumination insights'));
    assert.ok(result.includes('Always check null before access'));
  });

  it('invalidateCache clears cached data', () => {
    enricher._cache.skills = { fake: true };
    enricher._cache.research = ['cached'];
    enricher.invalidateCache();
    assert.equal(enricher._cache.skills, null);
    assert.equal(enricher._cache.research, null);
  });
});
