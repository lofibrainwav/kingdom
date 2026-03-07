/**
 * Zettelkasten Integration Tests
 *
 * Tests the full integration between:
 *   SkillZettelkasten → RuminationEngine → GoTReasoner → ZettelkastenHooks
 *
 * Requires Redis on port 6380 (same as other integration tests).
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');

const { SkillZettelkasten } = require('../agent/memory/skill-zettelkasten');
const { RuminationEngine } = require('../agent/memory/rumination-engine');
const { GoTReasoner } = require('../agent/memory/got-reasoner');
const { ZettelkastenHooks } = require('../agent/memory/zettelkasten-hooks');
const { Blackboard } = require('../agent/core/blackboard');

// Temp vault dir to avoid polluting real vault/
const TEMP_VAULT = path.join(os.tmpdir(), `kingdom-zk-test-${Date.now()}`);

// Test-only prefix to avoid wiping production zettelkasten data
const TEST_ZK_PREFIX = 'test-zettelkasten';

// Clean up Redis keys used by these tests (test prefix only)
async function cleanZkKeys(board) {
  const client = board.client;
  const keys = await client.keys(`kingdom:${TEST_ZK_PREFIX}:*`);
  if (keys.length > 0) await client.del(keys);
  const configKeys = await client.keys(`kingdom:config:${TEST_ZK_PREFIX}:*`);
  if (configKeys.length > 0) await client.del(configKeys);
}

// ── SkillZettelkasten CRUD + XP ─────────────────────────────────────

describe('SkillZettelkasten — CRUD + XP', () => {
  let zk, cleanupBoard;

  before(async () => {
    cleanupBoard = new Blackboard();
    await cleanupBoard.connect();
    await cleanZkKeys(cleanupBoard);

    zk = new SkillZettelkasten({ zkPrefix: TEST_ZK_PREFIX, vaultDir: path.join(TEMP_VAULT, 'crud') });
    await zk.init();
  });

  after(async () => {
    await cleanZkKeys(cleanupBoard);
    await zk.shutdown();
    await cleanupBoard.disconnect();
  });

  it('createNote should create an atomic note with Novice tier', async () => {
    const note = await zk.createNote({
      name: 'avoid_lava',
      code: 'bot.pathfinder.avoid("lava")',
      description: 'Avoid lava blocks',
      errorType: 'lava',
      agentId: 'builder-01',
    });

    assert.equal(note.name, 'avoid_lava');
    assert.equal(note.tier, 'Novice');
    assert.equal(note.xp, 0);
    assert.equal(note.uses, 0);
    assert.ok(note.tags.includes('atomic'));
  });

  it('getNote should retrieve a stored note', async () => {
    const note = await zk.getNote('avoid-lava');
    assert.ok(note);
    assert.equal(note.name, 'avoid_lava');
    assert.equal(note.id, 'avoid-lava');
  });

  it('recordUsage should add XP and update stats', async () => {
    const result = await zk.recordUsage('avoid-lava', true);
    assert.ok(result);
    assert.equal(result.xpGain, 3); // success = 3 XP
    assert.equal(result.note.uses, 1);
    assert.equal(result.note.successes, 1);
    assert.equal(result.note.xp, 3);
  });

  it('recordUsage with failure should give 1 XP', async () => {
    const result = await zk.recordUsage('avoid-lava', false);
    assert.equal(result.xpGain, 1);
    assert.equal(result.note.failures, 1);
    assert.equal(result.note.xp, 4); // 3 + 1
  });

  it('recordUsage should return null for non-existent skill', async () => {
    const result = await zk.recordUsage('does-not-exist', true);
    assert.equal(result, null);
  });
});

// ── XP Flow: Tier Progression ──────────────────────────────────────

describe('SkillZettelkasten — Full XP Flow (Novice → Apprentice)', () => {
  let zk, cleanupBoard;

  before(async () => {
    cleanupBoard = new Blackboard();
    await cleanupBoard.connect();
    await cleanZkKeys(cleanupBoard);

    zk = new SkillZettelkasten({ zkPrefix: TEST_ZK_PREFIX, vaultDir: path.join(TEMP_VAULT, 'xp-flow') });
    await zk.init();

    await zk.createNote({
      name: 'xp_test_skill',
      code: 'return true;',
      errorType: 'test',
      agentId: 'test',
    });
  });

  after(async () => {
    await cleanZkKeys(cleanupBoard);
    await zk.shutdown();
    await cleanupBoard.disconnect();
  });

  it('should tier up from Novice to Apprentice after 10+ XP', async () => {
    // Need 10 XP for Apprentice. Success = 3 XP, so 4 successes = 12 XP
    let tieredUp = false;
    for (let i = 0; i < 4; i++) {
      const result = await zk.recordUsage('xp-test-skill', true);
      if (result.tieredUp) tieredUp = true;
    }

    assert.ok(tieredUp, 'Expected tier-up to occur');
    const note = await zk.getNote('xp-test-skill');
    assert.equal(note.tier, 'Apprentice');
    assert.equal(note.xp, 12);
  });
});

// ── RuminationEngine ──────────────────────────────────────────────

describe('RuminationEngine — Feed + Digest', () => {
  let zk, rum, cleanupBoard;

  before(async () => {
    cleanupBoard = new Blackboard();
    await cleanupBoard.connect();
    await cleanZkKeys(cleanupBoard);

    zk = new SkillZettelkasten({ zkPrefix: TEST_ZK_PREFIX, vaultDir: path.join(TEMP_VAULT, 'rumination') });
    await zk.init();
    rum = new RuminationEngine(zk);
    await rum.init();
  });

  after(async () => {
    await cleanZkKeys(cleanupBoard);
    await rum.shutdown();
    await zk.shutdown();
    await cleanupBoard.disconnect();
  });

  it('feed should buffer experiences', () => {
    rum.feed({ errorType: 'pathfinding', succeeded: true, skillUsed: 'nav-v1' });
    rum.feed({ errorType: 'pathfinding', succeeded: true, skillUsed: 'nav-v1' });
    rum.feed({ errorType: 'pathfinding', succeeded: false, skillUsed: 'nav-v1' });
    assert.equal(rum.rawBuffer.length, 3);
  });

  it('digest should process buffered experiences and produce insights', async () => {
    const result = await rum.digest();
    assert.ok(result.digested >= 3);
    assert.equal(rum.rawBuffer.length, 0, 'Buffer should be drained');
    assert.equal(rum.totalDigestions, 1);
  });

  it('digest with empty buffer should return 0', async () => {
    const result = await rum.digest();
    assert.equal(result.digested, 0);
    assert.equal(result.insights.length, 0);
  });
});

// ── GoTReasoner ──────────────────────────────────────────────────

describe('GoTReasoner — Graph + Synergies', () => {
  let zk, got, cleanupBoard;

  before(async () => {
    cleanupBoard = new Blackboard();
    await cleanupBoard.connect();
    await cleanZkKeys(cleanupBoard);

    zk = new SkillZettelkasten({ zkPrefix: TEST_ZK_PREFIX, vaultDir: path.join(TEMP_VAULT, 'got') });
    await zk.init();
    got = new GoTReasoner(zk, { vaultDir: path.join(TEMP_VAULT, 'got', 'reasoning') });
    await got.init();
  });

  after(async () => {
    await cleanZkKeys(cleanupBoard);
    await got.shutdown();
    await zk.shutdown();
    await cleanupBoard.disconnect();
  });

  it('buildGraph with empty Zettelkasten should return empty graph', async () => {
    const graph = await got.buildGraph();
    assert.equal(Object.keys(graph.nodes).length, 0);
    assert.equal(graph.edges.length, 0);
  });

  it('discoverSynergies with empty graph should return 0 synergies', async () => {
    const synergies = await got.discoverSynergies();
    assert.equal(synergies.length, 0);
  });

  it('buildGraph should include created notes', async () => {
    await zk.createNote({ name: 'skill_a', code: 'a()', errorType: 'nav', agentId: 'test' });
    await zk.createNote({ name: 'skill_b', code: 'b()', errorType: 'nav', agentId: 'test' });

    const graph = await got.buildGraph();
    assert.equal(Object.keys(graph.nodes).length, 2);
    assert.ok(graph.nodes['skill-a']);
    assert.ok(graph.nodes['skill-b']);
  });
});

// ── ZettelkastenHooks Wiring ──────────────────────────────────────

describe('ZettelkastenHooks — Wiring', () => {
  let zk, rum, got, hooks, cleanupBoard;

  before(async () => {
    cleanupBoard = new Blackboard();
    await cleanupBoard.connect();
    await cleanZkKeys(cleanupBoard);

    zk = new SkillZettelkasten({ zkPrefix: TEST_ZK_PREFIX, vaultDir: path.join(TEMP_VAULT, 'hooks') });
    await zk.init();
    rum = new RuminationEngine(zk);
    await rum.init();
    got = new GoTReasoner(zk, { vaultDir: path.join(TEMP_VAULT, 'hooks', 'reasoning') });
    await got.init();
    hooks = new ZettelkastenHooks(zk, rum, got);
    await hooks.init();
  });

  after(async () => {
    await cleanZkKeys(cleanupBoard);
    await hooks.shutdown();
    await got.shutdown();
    await rum.shutdown();
    await zk.shutdown();
    await cleanupBoard.disconnect();
  });

  it('wireToBuilder should feed rumination on _tryLearnedSkill', async () => {
    const mockBuilder = {
      id: 'builder-test',
      _tryLearnedSkill: async () => ({ skillName: 'test-skill', success: true, coSkills: [] }),
      _selfImprove: async () => true,
    };

    hooks.wireToBuilder(mockBuilder);

    // Call the wrapped method
    await mockBuilder._tryLearnedSkill(new Error('test'));

    // Rumination buffer should have been fed
    assert.ok(rum.rawBuffer.length >= 1, 'Rumination should have received experience');
    const last = rum.rawBuffer[rum.rawBuffer.length - 1];
    assert.equal(last.agentId, 'builder-test');
    assert.equal(last.succeeded, true);
  });

  it('wireToLeader should trigger GoT and pass result to leader', async () => {
    let gotCalled = false;
    let feedbackReceived = null;
    const originalCycle = got.fullReasoningCycle.bind(got);
    got.fullReasoningCycle = async () => {
      gotCalled = true;
      return {
        synergies: [], gaps: [], evolutions: [],
        summary: { totalSynergies: 0, totalGaps: 0, criticalGaps: 0, closestToMaster: 'none' },
      };
    };

    const mockLeader = {
      triggerGroupReflexion: async () => ({ entries: 3, agents: 3 }),
      processGoTFeedback: async (result) => { feedbackReceived = result; return { actions: [] }; },
    };

    hooks.wireToLeader(mockLeader);
    await mockLeader.triggerGroupReflexion();

    assert.ok(gotCalled, 'GoT fullReasoningCycle should have been called');
    assert.ok(feedbackReceived, 'processGoTFeedback should have received GoT result');
    assert.equal(feedbackReceived.summary.totalSynergies, 0);

    // Restore
    got.fullReasoningCycle = originalCycle;
  });

  it('wireToSkillPipeline should create Zettelkasten note on deploy', async () => {
    const mockPipeline = {
      deploySkill: async (json) => ({ success: true, skill: json.name }),
      updateSuccessRate: async () => ({}),
    };

    hooks.wireToSkillPipeline(mockPipeline);

    await mockPipeline.deploySkill({
      name: 'hooked_skill',
      code: 'return 42;',
      description: 'Test hook deployment',
      errorType: 'test',
    });

    // Note should exist in Zettelkasten
    const note = await zk.getNote('hooked-skill');
    assert.ok(note, 'Note should have been created by hook');
    assert.equal(note.name, 'hooked_skill');
  });
});

// ── ZettelkastenHooks — newSkill Guard ────────────────────────────

describe('ZettelkastenHooks — newSkill Guard', () => {
  let hooks;

  before(async () => {
    // Minimal hooks with stubs (no Redis needed for _onSkillDeployed)
    const stubZk = { getStats: async () => ({}) };
    const stubRum = { getStats: () => ({}), init: async () => {} };
    const stubGot = { init: async () => {} };
    hooks = new ZettelkastenHooks(stubZk, stubRum, stubGot);
    // Don't call init() — avoid Redis subscription for this unit test
  });

  it('should ignore events without newSkill field', async () => {
    let logged = false;
    hooks.logger = { logEvent: async () => { logged = true; } };

    // Safety alert: has failureType but no newSkill
    await hooks._onSkillDeployed({ failureType: 'fall', triggerSkillCreation: true });

    assert.equal(logged, false, 'Should not log when newSkill is missing');
  });

  it('should process events with valid newSkill', async () => {
    let logged = false;
    hooks.logger = { logEvent: async () => { logged = true; } };

    await hooks._onSkillDeployed({ newSkill: 'avoid_lava_v1' });

    assert.equal(logged, true, 'Should log when newSkill is present');
  });
});

// ── Compound Skill Creation ─────────────────────────────────────

describe('SkillZettelkasten — Compound Creation', () => {
  let zk, cleanupBoard;

  before(async () => {
    cleanupBoard = new Blackboard();
    await cleanupBoard.connect();
    await cleanZkKeys(cleanupBoard);

    zk = new SkillZettelkasten({ zkPrefix: TEST_ZK_PREFIX, vaultDir: path.join(TEMP_VAULT, 'compound') });
    await zk.init();

    // Create two skills
    await zk.createNote({ name: 'dig_down', code: 'dig()', errorType: 'mining', agentId: 'test' });
    await zk.createNote({ name: 'place_torch', code: 'torch()', errorType: 'lighting', agentId: 'test' });
  });

  after(async () => {
    await cleanZkKeys(cleanupBoard);
    await zk.shutdown();
    await cleanupBoard.disconnect();
  });

  it('should create compound note after 5+ co-occurrences with 70%+ strength', async () => {
    // Build up independent usage first (taste verification requires MIN_USES >= 3)
    for (let i = 0; i < 3; i++) {
      await zk.recordUsage('place-torch', true);
    }

    // Simulate 5 successful co-occurrences + 1 failure (5/6 = 83% strength)
    for (let i = 0; i < 5; i++) {
      await zk.recordUsage('dig-down', true, { coSkills: ['place-torch'] });
    }
    await zk.recordUsage('dig-down', false, { coSkills: ['place-torch'] });

    // Check if compound was created
    const compound = await zk.getNote('compound-dig-down-place-torch');
    // The compound key is sorted alphabetically: dig-down vs place-torch
    // _linkKey sorts: ['dig-down', 'place-torch'] → 'dig-down::place-torch'
    // _suggestCompound: `compound_${skillIdA}_${skillIdB}` → compound_dig-down_place-torch
    // But slugified: compound-dig-down-place-torch
    assert.ok(compound, 'Compound note should have been created');
    assert.ok(compound.compoundOf, 'Should have compoundOf field');
    assert.equal(compound.status, 'compound');
    assert.ok(compound.xp > 0, 'Compound should inherit XP from parents');
  });
});

// ── Taste Verification ──────────────────────────────────────

describe('SkillZettelkasten — Taste Verification', () => {
  let zk, cleanupBoard;

  before(async () => {
    cleanupBoard = new Blackboard();
    await cleanupBoard.connect();
    await cleanZkKeys(cleanupBoard);

    zk = new SkillZettelkasten({ zkPrefix: TEST_ZK_PREFIX, vaultDir: path.join(TEMP_VAULT, 'taste') });
    await zk.init();
  });

  after(async () => {
    await cleanZkKeys(cleanupBoard);
    await zk.shutdown();
    await cleanupBoard.disconnect();
  });

  it('should reject compound when parent has insufficient uses', async () => {
    await zk.createNote({ name: 'taste_a', code: 'a()', errorType: 'test', agentId: 'test' });
    await zk.createNote({ name: 'taste_b', code: 'b()', errorType: 'test', agentId: 'test' });

    const link = { strength: 0.8, coOccurrences: 5, coSuccesses: 4 };
    const result = await zk._tasteVerify('taste-a', 'taste-b', link);
    assert.equal(result.pass, false);
    assert.ok(result.reasons.some(r => r.includes('underused')));
  });

  it('should pass when both parents meet all criteria', async () => {
    await zk.createNote({ name: 'taste_c', code: 'c()', errorType: 'nav', agentId: 'test' });
    await zk.createNote({ name: 'taste_d', code: 'd()', errorType: 'build', agentId: 'test' });

    for (let i = 0; i < 3; i++) {
      await zk.recordUsage('taste-c', true);
      await zk.recordUsage('taste-d', true);
    }

    const link = { strength: 0.85, coOccurrences: 6, coSuccesses: 5 };
    const result = await zk._tasteVerify('taste-c', 'taste-d', link);
    assert.equal(result.pass, true);
    assert.equal(result.reasons.length, 0);
  });

  it('should reject when link strength is below threshold', async () => {
    const link = { strength: 0.5, coOccurrences: 6, coSuccesses: 3 };
    const result = await zk._tasteVerify('taste-c', 'taste-d', link);
    assert.equal(result.pass, false);
    assert.ok(result.reasons.some(r => r.includes('strength')));
  });
});

// ── Vault File Persistence ──────────────────────────────────────

describe('SkillZettelkasten — Vault Persistence', () => {
  let zk, cleanupBoard;

  before(async () => {
    cleanupBoard = new Blackboard();
    await cleanupBoard.connect();
    await cleanZkKeys(cleanupBoard);

    zk = new SkillZettelkasten({ zkPrefix: TEST_ZK_PREFIX, vaultDir: path.join(TEMP_VAULT, 'vault-persist') });
    await zk.init();
  });

  after(async () => {
    await cleanZkKeys(cleanupBoard);
    await zk.shutdown();
    await cleanupBoard.disconnect();
  });

  it('should write .md file to vault on createNote', async () => {
    await zk.createNote({
      name: 'vault_test',
      code: 'test()',
      errorType: 'test',
      agentId: 'test',
    });

    const filepath = path.join(TEMP_VAULT, 'vault-persist', 'atomic', 'vault-test.md');
    assert.ok(fs.existsSync(filepath), 'Vault file should exist');

    const content = fs.readFileSync(filepath, 'utf-8');
    assert.equal(content.includes('vault_test'), true, 'File should contain skill name');
    assert.equal(content.includes('Novice'), true, 'File should contain tier');
  });
});

// ── Supplemental Coverage for SkillZettelkasten ─────────────────

describe('SkillZettelkasten — Supplemental Coverage (100% Lines)', () => {
  let cleanupBoard;

  before(async () => {
    cleanupBoard = new Blackboard();
    await cleanupBoard.connect();
    await cleanZkKeys(cleanupBoard);
  });

  after(async () => {
    await cleanZkKeys(cleanupBoard);
    await cleanupBoard.disconnect();
  });

  it('Constructor should accept Blackboard instance directly', () => {
    const directZk = new SkillZettelkasten(cleanupBoard, '/tmp/zk-test');
    assert.equal(directZk.board, cleanupBoard);
    assert.equal(directZk.vaultDir, '/tmp/zk-test');
    assert.equal(directZk.logger, null);
    assert.equal(directZk.zkPrefix, 'zettelkasten');
  });

  it('Logger should receive logEvent calls on createNote and recordUsage', async () => {
    let logEvents = [];
    const mockLogger = { logEvent: (sys, data) => logEvents.push(data) };
    const logZk = new SkillZettelkasten({ board: cleanupBoard, logger: mockLogger, zkPrefix: TEST_ZK_PREFIX, vaultDir: path.join(TEMP_VAULT, 'logger-test') });
    await logZk.init();

    await logZk.createNote({ name: 'log-skill', errorType: 'err', agentId: 'bot' });
    assert.equal(logEvents.length, 1);
    assert.equal(logEvents[0].type, 'note_created');

    await logZk.recordUsage('log-skill', true);
    assert.equal(logEvents.length, 2);
    assert.equal(logEvents[1].type, 'usage_recorded');
  });

  it('Analytics methods (getStats, getByTier, getStrongestLinks, deprecateNote)', async () => {
    const aZk = new SkillZettelkasten({ board: cleanupBoard, zkPrefix: TEST_ZK_PREFIX, vaultDir: path.join(TEMP_VAULT, 'analytics') });
    await aZk.init();

    await aZk.createNote({ name: 'a1', agentId: 'test' });
    await aZk.createNote({ name: 'a2', agentId: 'test' });
    await aZk.createNote({ name: 'a3', agentId: 'test' });
    
    // artificially rank up a1 to Apprentice
    for(let i=0; i<4; i++) await aZk.recordUsage('a1', true, { coSkills: ['a2'] });

    // getByTier
    const novices = await aZk.getByTier('Novice');
    const apprentices = await aZk.getByTier('Apprentice');
    assert.ok(novices.length >= 2);
    assert.ok(apprentices.length >= 1);
    
    // getStrongestLinks
    const links = await aZk.getStrongestLinks(0.1, 5);
    assert.ok(links.length > 0);
    assert.equal(links[0].a, 'a1');
    assert.equal(links[0].b, 'a2');

    // deprecateNote
    const depNull = await aZk.deprecateNote('missing-node');
    assert.equal(depNull, null);
    
    const depNode = await aZk.deprecateNote('a3', 'test_reason');
    assert.equal(depNode.status, 'deprecated');

    // test deprecate with non-existent file path fallback (silent catch)
    const depNode2 = await aZk.deprecateNote('a2', 'test2');
    assert.equal(depNode2.status, 'deprecated');
    // second time file doesn't exist, hits catch block
    await aZk.deprecateNote('a2', 'test2_again');

    // getStats
    const stats = await aZk.getStats();
    assert.ok(stats.totalNotes >= 3);
    assert.ok(stats.deprecatedSkills >= 2);
    assert.ok(stats.activeSkills >= 1);
    assert.ok(stats.totalXP > 0);
    assert.ok(stats.tierDistribution['Apprentice'] >= 1);
  });
});
