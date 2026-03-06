const { describe, it, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const { ZettelkastenHooks } = require('../agent/memory/zettelkasten-hooks');
const { Blackboard } = require('../agent/core/blackboard');

describe('ZettelkastenHooks - Unit Tests & Coverage', () => {
  let hooks, zkMock, ruminationMock, gotMock, loggerMock;
  let subMock;

  beforeEach(() => {
    // 1. Mock Blackboard internals
    subMock = {
      on: mock.fn(),
      subscribe: mock.fn(),
      unsubscribe: mock.fn(),
      disconnect: mock.fn(),
    };

    // Override Blackboard default behavior
    mock.method(Blackboard.prototype, 'connect', async () => {});
    mock.method(Blackboard.prototype, 'disconnect', async () => {});
    mock.method(Blackboard.prototype, 'createSubscriber', async () => subMock);
    mock.method(Blackboard.prototype, 'publish', async () => {});

    // 2. Mock ZK / Rumination / GoT
    zkMock = {
      createNote: mock.fn(),
      recordUsage: mock.fn(),
      deprecateNote: mock.fn(),
      getStats: mock.fn(),
      _slugify: (str) => str.toLowerCase().replace(/\\s+/g, '-'),
    };
    ruminationMock = {
      feed: mock.fn(),
      feedFailure: mock.fn(),
      deepRuminate: mock.fn(),
      getStats: mock.fn(),
    };
    gotMock = {
      fullReasoningCycle: mock.fn(),
    };
    loggerMock = {
      logEvent: mock.fn(),
    };

    hooks = new ZettelkastenHooks(zkMock, ruminationMock, gotMock, {
      logger: loggerMock,
      reasoningThreshold: 2,
      deepRuminationIntervalMs: 1000,
    });
  });

  afterEach(async () => {
    // Clear deepTimer and reset mocks
    await hooks.shutdown();
    mock.restoreAll();
  });

  describe('Init & Shutdown', () => {
    it('should initialize connections and subscribe to events', async () => {
      await hooks.init();
      assert.equal(subMock.on.mock.callCount(), 1); // error handler
      assert.equal(subMock.subscribe.mock.callCount(), 4); // 4 topics
      assert.ok(hooks.subscriber === subMock);
    });

    it('should handle sub errors gracefully', async () => {
      await hooks.init();
      const errHandler = subMock.on.mock.calls[0].arguments[1];
      // trigger error
      assert.doesNotThrow(() => errHandler(new Error('sub error')));
    });

    it('should shutdown safely even if subscriber is missing', async () => {
      // no init, so subscriber is null
      await hooks.shutdown();
      assert.equal(subMock.unsubscribe.mock.callCount(), 0);
    });
  });

  describe('Event Handlers (Subscriber Callbacks)', () => {
    let callbacks = {};
    beforeEach(async () => {
      await hooks.init();
      for (const call of subMock.subscribe.mock.calls) {
        callbacks[call.arguments[0]] = call.arguments[1];
      }
    });

    it('should handle skills:emergency events and log', async () => {
      const fn = callbacks['knowledge:skills:deployed'];
      await fn({ newSkill: 'test-skill' });
      assert.equal(loggerMock.logEvent.mock.callCount(), 1);

      // JSON parsing error should be caught
      await fn('invalid json');

      // Exception inside logger should be caught
      loggerMock.logEvent.mock.mockImplementation(async () => { throw new Error('log fail'); });
      await fn({ newSkill: 'fail-log' });
      assert.equal(loggerMock.logEvent.mock.callCount(), 2);
    });

    it('should handle rumination:digested events and optionally trigger GoT', async () => {
      const fn = callbacks['knowledge:rumination:digested'];
      // reasoningThreshold is 2
      gotMock.fullReasoningCycle.mock.mockImplementation(async () => ({ summary: { totalSynergies: 0 } }));
      
      await fn('{}'); // 1st
      assert.equal(hooks.ruminationsSinceReasoning, 1);
      assert.equal(gotMock.fullReasoningCycle.mock.callCount(), 0);

      await fn('{}'); // 2nd -> triggers GoT
      assert.equal(gotMock.fullReasoningCycle.mock.callCount(), 1);
      assert.equal(hooks.ruminationsSinceReasoning, 0);

      // Error handling
      await fn('invalid json');
      gotMock.fullReasoningCycle.mock.mockImplementation(async () => { throw new Error('GoT Fail'); });
      hooks.ruminationsSinceReasoning = 1;
      await fn('{}'); // will catch GoT failure

      // Test processGoTFeedback fire-and-forget catch
      hooks.wireToLeader({ 
        triggerGroupReflexion: async () => {},
        processGoTFeedback: async () => { throw new Error('Feed error'); } 
      });
      gotMock.fullReasoningCycle.mock.mockImplementation(async () => ({ result: true }));
      hooks.ruminationsSinceReasoning = 1;
      await fn('{}');
      await new Promise(r => setTimeout(r, 20)); // wait for background promise
    });

    it('should handle zettelkasten:tier-up', async () => {
      const fn = callbacks['knowledge:zettelkasten:tier-up'];
      await fn({ skill: 'dig', newTier: 'Master', xp: 100 });
      assert.equal(loggerMock.logEvent.mock.callCount(), 1);

      // Invalid json
      await fn('not json');
    });

    it('should handle zettelkasten:compound-created', async () => {
      const fn = callbacks['knowledge:zettelkasten:compound-created'];
      await fn({ compound: 'dig-build', sources: [] });
      assert.equal(loggerMock.logEvent.mock.callCount(), 1);

      // Invalid json
      await fn('not json');
    });
  });

  describe('Wiring to Agents', () => {
    it('wireToBuilder should intercept tryLearnedSkill and feed rumination & zk', async () => {
      const builder = {
        id: 'bob',
        _tryLearnedSkill: async () => ({ skillName: 'chop', success: true, coSkills: ['nav'] }),
        _selfImprove: async () => true,
      };
      hooks.wireToBuilder(builder);

      const res = await builder._tryLearnedSkill(new Error('Need wood'));
      assert.equal(res.success, true);
      assert.equal(ruminationMock.feed.mock.callCount(), 1);
      assert.equal(zkMock.recordUsage.mock.callCount(), 1);
    });

    it('wireToBuilder should handle missing methods or errors', async () => {
      hooks.wireToBuilder({}); // no effect
      
      const builder = {
        id: 'alice',
        _tryLearnedSkill: async () => ({ skillName: 'chop', success: true }),
        _selfImprove: async () => true,
      };
      hooks.wireToBuilder(builder);

      zkMock.recordUsage.mock.mockImplementation(async () => { throw new Error('ZK DB fail'); });
      await builder._tryLearnedSkill(new Error('err'));
      assert.equal(zkMock.recordUsage.mock.callCount(), 1); // error caught

      // Original method can return null
      builder._tryLearnedSkill = async () => null;
      hooks.wireToBuilder(builder); // double wire override test
      await builder._tryLearnedSkill(new Error('empty'));
    });

    it('wireToBuilder should intercept _selfImprove', async () => {
      const builder = {
        id: 'bob',
        _selfImprove: async () => true,
        _tryLearnedSkill: async () => true,
      };
      hooks.wireToBuilder(builder);
      await builder._selfImprove(new Error('fail'));
      assert.equal(ruminationMock.feedFailure.mock.callCount(), 1);
    });

    it('wireToLeader should trigger GoT after reflexion', async () => {
      const leader = {
        triggerGroupReflexion: async () => ({ ok: true }),
        processGoTFeedback: async () => {},
      };
      gotMock.fullReasoningCycle.mock.mockImplementation(async () => ({ summary: { totalSynergies: 1 } }));
      
      hooks.wireToLeader(leader);
      await leader.triggerGroupReflexion();
      assert.equal(gotMock.fullReasoningCycle.mock.callCount(), 1);
      assert.equal(loggerMock.logEvent.mock.callCount(), 1);

      // Trigger error in GoT Feedback
      leader.processGoTFeedback = async () => { throw new Error('GoT Feedback Error'); };
      await assert.doesNotReject(() => leader.triggerGroupReflexion());
      await new Promise(r => setTimeout(r, 20));
    });

    it('wireToSkillPipeline should create atomic note on deploy', async () => {
      const pipeline = {
        deploySkill: async () => ({ deployed: true }),
        updateSuccessRate: async () => ({ discarded: true }),
      };
      hooks.wireToSkillPipeline(pipeline);

      await pipeline.deploySkill({ name: 'attack', code: 'attack()' });
      assert.equal(zkMock.createNote.mock.callCount(), 1);

      zkMock.createNote.mock.mockImplementation(async () => { throw new Error('zk failed'); });
      await pipeline.deploySkill({ name: 'error', code: 'err()' }); // caught

      await pipeline.updateSuccessRate('attack', false);
      assert.equal(zkMock.recordUsage.mock.callCount(), 1);
      assert.equal(zkMock.deprecateNote.mock.callCount(), 1);

      zkMock.recordUsage.mock.mockImplementation(async () => { throw new Error('db err'); });
      await pipeline.updateSuccessRate('fail', false); // caught
    });
  });

  describe('Deep Rumination & Stats', () => {
    it('deepTimer triggers deepRuminate and handles errors', async () => {
      let cbToRun = null;
      const ogInterval = global.setInterval;
      global.setInterval = (cb) => { cbToRun = cb; return 999; };
      
      await hooks.init();
      global.setInterval = ogInterval;

      // trigger success
      await cbToRun();
      assert.equal(ruminationMock.deepRuminate.mock.callCount(), 1);

      // trigger error
      ruminationMock.deepRuminate.mock.mockImplementation(async () => { throw new Error('deep error'); });
      await cbToRun(); // shouldn't throw
      assert.equal(ruminationMock.deepRuminate.mock.callCount(), 2);
    });

    it('getFullStats should combine zk and rumination stats', async () => {
      zkMock.getStats.mock.mockImplementation(async () => ({ notes: 10 }));
      ruminationMock.getStats.mock.mockImplementation(() => ({ buffered: 5 }));

      const stats = await hooks.getFullStats();
      assert.equal(stats.zettelkasten.notes, 10);
      assert.equal(stats.rumination.buffered, 5);
      assert.equal(stats.reasoningThreshold, 2);
    });
  });
});
