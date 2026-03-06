/**
 * Rumination Engine tests.
 * Tests the 4-stomach digestion cycle: raw intake, pattern filtering,
 * insight extraction, and action generation.
 */
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { RuminationEngine, RUMINATION_INTERVAL } = require('../agent/memory/rumination-engine');

// ── Mock Helpers ────────────────────────────────────────────

function createMockZettelkasten(notes = {}) {
  return {
    getAllNotes: async () => notes,
    _linkKey: (a, b) => [a, b].sort().join('::'),
    recordUsage: async () => ({ tierUp: false }),
    getNote: async (id) => notes[id] ? { ...notes[id] } : null,
    board: {
      setHashField: async () => {},
      getConfig: async () => null,
    },
    _writeVaultNote: async () => {},
  };
}


// ── Tests ───────────────────────────────────────────────────

describe('RuminationEngine — Constructor', () => {
  it('should initialize with empty buffer', () => {
    const zk = createMockZettelkasten();
    const engine = new RuminationEngine(zk);
    assert.equal(engine.rawBuffer.length, 0);
    assert.equal(engine.totalDigestions, 0);
    assert.equal(engine.zk, zk);
  });

  it('should accept optional logger', () => {
    const logger = { logEvent: () => {} };
    const engine = new RuminationEngine(createMockZettelkasten(), { logger });
    assert.equal(engine.logger, logger);
  });
});

describe('RuminationEngine — feed / feedFailure', () => {
  let engine;

  beforeEach(() => {
    engine = new RuminationEngine(createMockZettelkasten());
  });

  it('should add experience to rawBuffer', () => {
    engine.feed({ skillUsed: 'dig', succeeded: true });
    assert.equal(engine.rawBuffer.length, 1);
    assert.ok(engine.rawBuffer[0].ingestedAt > 0);
    assert.equal(engine.rawBuffer[0].digested, false);
  });

  it('should add multiple experiences', () => {
    engine.feed({ skillUsed: 'dig', succeeded: true });
    engine.feed({ skillUsed: 'place', succeeded: false });
    engine.feed({ skillUsed: 'craft', succeeded: true });
    assert.equal(engine.rawBuffer.length, 3);
  });

  it('should mark failures with nutrition multiplier', () => {
    engine.feedFailure({ skillUsed: 'dig', errorType: 'pathfinder:stuck' });
    assert.equal(engine.rawBuffer.length, 1);
    assert.equal(engine.rawBuffer[0].type, 'failure');
    assert.equal(engine.rawBuffer[0].nutritionMultiplier, 1.5);
  });
});

describe('RuminationEngine — _filterPatterns (Stomach 2)', () => {
  let engine;

  beforeEach(() => {
    engine = new RuminationEngine(createMockZettelkasten());
  });

  it('should group experiences by error type', () => {
    const exps = [
      { errorType: 'dig:fail', skillUsed: 'dig_v1', succeeded: true },
      { errorType: 'dig:fail', skillUsed: 'dig_v2', succeeded: false },
      { errorType: 'nav:stuck', skillUsed: 'pathfind', succeeded: true },
    ];

    const patterns = engine._filterPatterns(exps);

    assert.ok(patterns['dig:fail']);
    assert.equal(patterns['dig:fail'].experiences.length, 2);
    assert.equal(patterns['dig:fail'].successCount, 1);
    assert.equal(patterns['dig:fail'].failureCount, 1);
    assert.ok(patterns['dig:fail'].skillsInvolved.includes('dig_v1'));
    assert.ok(patterns['dig:fail'].skillsInvolved.includes('dig_v2'));

    assert.ok(patterns['nav:stuck']);
    assert.equal(patterns['nav:stuck'].experiences.length, 1);
  });

  it('should collect co-skills', () => {
    const exps = [
      { errorType: 'build:fail', skillUsed: 'place', coSkills: ['dig', 'craft'], succeeded: true },
    ];

    const patterns = engine._filterPatterns(exps);

    assert.ok(patterns['build:fail'].skillsInvolved.includes('place'));
    assert.ok(patterns['build:fail'].skillsInvolved.includes('dig'));
    assert.ok(patterns['build:fail'].skillsInvolved.includes('craft'));
  });

  it('should use "general" key when no error type or skill', () => {
    const exps = [
      { succeeded: true },
    ];

    const patterns = engine._filterPatterns(exps);
    assert.ok(patterns['general']);
  });
});

describe('RuminationEngine — _extractInsights (Stomach 3)', () => {
  let engine;

  beforeEach(() => {
    engine = new RuminationEngine(createMockZettelkasten());
  });

  it('should find effective skills (>50% success, 3+ samples)', () => {
    const patterns = {
      'dig:fail': {
        errorType: 'dig:fail',
        experiences: [{}, {}, {}],
        successCount: 2,
        failureCount: 1,
        skillsInvolved: ['dig_v2'],
      },
    };

    const insights = engine._extractInsights(patterns);

    const effective = insights.find(i => i.type === 'effective_skill');
    assert.ok(effective);
    assert.ok(effective.skills.includes('dig_v2'));
    assert.ok(effective.confidence > 0.5);
  });

  it('should find co-occurrence patterns (2+ skills, >60% success)', () => {
    const patterns = {
      'nav:complex': {
        errorType: 'nav:complex',
        experiences: [{}, {}, {}, {}],
        successCount: 3,
        failureCount: 1,
        skillsInvolved: ['pathfind', 'jump'],
      },
    };

    const insights = engine._extractInsights(patterns);

    const coOccurrence = insights.find(i => i.type === 'co_occurrence');
    assert.ok(coOccurrence);
    assert.ok(coOccurrence.skills.includes('pathfind'));
    assert.ok(coOccurrence.skills.includes('jump'));
  });

  it('should find failure patterns (3+ failures, <30% success)', () => {
    const patterns = {
      'combat:death': {
        errorType: 'combat:death',
        experiences: [{}, {}, {}, {}, {}],
        successCount: 1,
        failureCount: 4,
        skillsInvolved: ['sword_v1'],
      },
    };

    const insights = engine._extractInsights(patterns);

    const failure = insights.find(i => i.type === 'failure_pattern');
    assert.ok(failure);
    assert.ok(failure.insight.includes('Persistent failure'));
    assert.ok(failure.failureRate > 0.7);
  });

  it('should skip patterns with fewer than MIN_EXPERIENCES', () => {
    const patterns = {
      'rare:event': {
        errorType: 'rare:event',
        experiences: [{}, {}], // only 2, below MIN=3
        successCount: 2,
        failureCount: 0,
        skillsInvolved: ['rare_skill'],
      },
    };

    const insights = engine._extractInsights(patterns);
    assert.equal(insights.length, 0);
  });
});

describe('RuminationEngine — digest (Stomach 4)', () => {
  it('should return early if buffer too small', async () => {
    const engine = new RuminationEngine(createMockZettelkasten());
    engine.feed({ skillUsed: 'dig', succeeded: true });
    // only 1 experience, MIN is 3

    const result = await engine.digest();

    assert.equal(result.digested, 0);
    assert.equal(result.insights.length, 0);
    assert.equal(engine.rawBuffer.length, 1); // not drained
  });

  it('should process full digestion cycle', async () => {
    const published = [];
    const zk = createMockZettelkasten();
    const engine = new RuminationEngine(zk);
    engine.board = {
      connect: async () => {},
      disconnect: async () => {},
      publish: async (ch, data) => { published.push({ ch, data }); },
    };

    // Feed 4 experiences with same error type, 2 skills, >60% success
    engine.feed({ errorType: 'dig:fail', skillUsed: 'dig_v1', coSkills: ['dig_v2'], succeeded: true });
    engine.feed({ errorType: 'dig:fail', skillUsed: 'dig_v1', coSkills: ['dig_v2'], succeeded: true });
    engine.feed({ errorType: 'dig:fail', skillUsed: 'dig_v1', coSkills: ['dig_v2'], succeeded: true });
    engine.feed({ errorType: 'dig:fail', skillUsed: 'dig_v1', coSkills: ['dig_v2'], succeeded: false });

    const result = await engine.digest();

    assert.equal(result.digested, 4);
    assert.ok(result.insights.length > 0);
    assert.equal(engine.rawBuffer.length, 0); // buffer drained
    assert.equal(engine.totalDigestions, 1);
    // Should have published results
    assert.ok(published.some(p => p.ch === 'knowledge:rumination:digested'));
  });

  it('should call logger if provided', async () => {
    const logs = [];
    const zk = createMockZettelkasten();
    const engine = new RuminationEngine(zk, {
      logger: { logEvent: (type, data) => { logs.push({ type, data }); } },
    });
    engine.board = {
      connect: async () => {},
      disconnect: async () => {},
      publish: async () => {},
    };

    // Feed enough for insights
    for (let i = 0; i < 4; i++) {
      engine.feed({ errorType: 'test:err', skillUsed: 'test_skill', succeeded: true });
    }

    await engine.digest();

    assert.ok(logs.some(l => l.type === 'rumination'));
  });
});

describe('RuminationEngine — getStats', () => {
  it('should return current buffer size and digestion count', () => {
    const engine = new RuminationEngine(createMockZettelkasten());
    engine.feed({ skillUsed: 'a', succeeded: true });
    engine.feed({ skillUsed: 'b', succeeded: false });

    const stats = engine.getStats();

    assert.equal(stats.bufferSize, 2);
    assert.equal(stats.totalDigestions, 0);
  });
});

describe('RuminationEngine — shutdown', () => {
  it('should clear timer and disconnect board', async () => {
    const engine = new RuminationEngine(createMockZettelkasten());
    let disconnected = false;
    engine.board = { disconnect: async () => { disconnected = true; } };
    engine.digestTimer = setInterval(() => {}, 999999);

    await engine.shutdown();

    assert.ok(disconnected);
    assert.equal(engine.digestTimer._destroyed, true);
  });
});

describe('RuminationEngine — RUMINATION_INTERVAL', () => {
  it('should be 5 minutes in milliseconds', () => {
    assert.equal(RUMINATION_INTERVAL, 5 * 60 * 1000);
  });
});

describe('RuminationEngine — deepRuminate', () => {
  let engine, zkMock;
  beforeEach(() => {
    zkMock = createMockZettelkasten({
      'skill-a': { id: 'skill-a', status: 'active', links: ['skill-b'], successRate: 0.8, xp: 10, uses: 10, digestCount: 0, ruminationNotes: [] },
      'skill-b': { id: 'skill-b', status: 'active', links: ['skill-a'], successRate: 0.7, xp: 20, uses: 10, digestCount: 0, ruminationNotes: [] },
      'skill-c': { id: 'skill-c', status: 'active', links: [], successRate: 0.2, xp: 5, uses: 10, digestCount: 0, ruminationNotes: [] }
    });
    // mock board config
    zkMock.board = {
      setHashField: async () => {},
      getConfig: async (key) => {
        if (key.includes('skill-a::skill-b')) return { strength: 0.7, coOccurrences: 5 };
        return null;
      }
    };
    engine = new RuminationEngine(zkMock);
  });

  it('should find compound candidates based on links and success rates', async () => {
    engine.board = zkMock.board; // share board mock
    const result = await engine.deepRuminate();
    assert.equal(result.discoveries.length, 1);
    assert.equal(result.discoveries[0].type, 'compound_candidate');
    assert.equal(result.discoveries[0].skillA, 'skill-a');
    assert.equal(result.discoveries[0].skillB, 'skill-b');
  });

  it('should find dormant skills and redigest them', async () => {
    engine.board = zkMock.board; 
    let writes = 0;
    zkMock._writeVaultNote = async () => { writes++; };
    
    const result = await engine.deepRuminate();
    assert.equal(result.reDigested, 1); // skill-c
    assert.equal(writes, 1);
  });
});

describe('RuminationEngine — actions (Stomach 4 handling)', () => {
  it('should execute actions based on insights (co_occurrence, effective_skill, failure_pattern)', async () => {
    const published = [];
    const zk = createMockZettelkasten({
      'dig_v1': { id: 'dig_v1', digestCount: 0, ruminationNotes: [] }
    });
    let recorded = 0;
    zk.recordUsage = async () => { recorded++; return true; };
    zk.board.setHashField = async () => {};
    
    const engine = new RuminationEngine(zk);
    engine.board = {
      connect: async () => {},
      publish: async (ch, data) => { published.push(data); },
    };
    
    // effective skill (needs > 50% success and length >= 3)
    for(let i=0; i<4; i++) engine.feed({ errorType: 'nav', skillUsed: 'jump_v2', succeeded: true });
    
    // co-occurrence (needs 2+ skills and > 60% success and length >= 3)
    for(let i=0; i<4; i++) engine.feed({ errorType: 'build', skillUsed: 'place', coSkills: ['craft'], succeeded: true });
    
    // failure pattern (needs >= 3 failures and < 30% success)
    for(let i=0; i<4; i++) engine.feed({ errorType: 'fight', skillUsed: 'dig_v1', succeeded: false });

    // 1 failure experience of fight to trigger gomguk
    const result = await engine.digest();
    assert.ok(result.insights.length >= 3);
    assert.ok(result.actions.length >= 3);
    assert.ok(recorded > 0);
  });
});

describe('RuminationEngine — init and start cycle', () => {
  it('init() should connect board and start timer', async () => {
    const engine = new RuminationEngine(createMockZettelkasten());
    let connected = false;
    engine.board.connect = async () => { connected = true; };
    await engine.init();
    assert.ok(connected);
    assert.ok(engine.digestTimer);
    await engine.shutdown();
  });

  it('should handle errors in periodic digestion cycle', async () => {
    const { RuminationEngine } = require('../agent/memory/rumination-engine');
    const engine = new RuminationEngine({ getStats: () => ({}) });
    engine.board = { connect: async () => {} };
    let digestCb = null;
    const ogSetInterval = global.setInterval;
    global.setInterval = (cb) => { digestCb = cb; return 999; };
    
    engine._startDigestionCycle();
    global.setInterval = ogSetInterval;

    engine.logger = { info: () => {} };
    engine.digest = async () => { throw new Error('periodic testing error'); };

    await digestCb();
    await new Promise(setImmediate); // Wait for the background promise to settle
    assert.ok(1); // the global log.error catches the error
  });
});
