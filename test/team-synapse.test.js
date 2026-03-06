/**
 * Phase 4: Team synapse wiring tests.
 * Verifies VaultBridge, RuminationEngine, and GoTReasoner
 * are registered in team.js AGENTS and connected to event flows.
 */
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// ── team.js AGENTS registration ─────────────────────────────

describe('team.js — Phase 4 synapse registration', () => {
  // We can't import team.js directly (it calls main()), so we verify
  // the source code imports and AGENTS entries.
  const fs = require('fs');
  const path = require('path');
  const teamSrc = fs.readFileSync(
    path.join(__dirname, '..', 'agent', 'team.js'),
    'utf-8'
  );

  it('should import VaultBridge', () => {
    assert.ok(teamSrc.includes("require('./memory/vault-bridge')"));
  });

  it('should import RuminationEngine', () => {
    assert.ok(teamSrc.includes("require('./memory/rumination-engine')"));
  });

  it('should import GoTReasoner', () => {
    assert.ok(teamSrc.includes("require('./memory/got-reasoner')"));
  });

  it('should import SkillZettelkasten for shared instance', () => {
    assert.ok(teamSrc.includes("require('./memory/skill-zettelkasten')"));
  });

  it('should register VaultBridge in AGENTS', () => {
    assert.ok(teamSrc.includes("name: 'VaultBridge'"));
  });

  it('should register RuminationEngine in AGENTS', () => {
    assert.ok(teamSrc.includes("name: 'RuminationEngine'"));
  });

  it('should register GoTReasoner in AGENTS', () => {
    assert.ok(teamSrc.includes("name: 'GoTReasoner'"));
  });

  it('should have 15 agents total (9 team + 6 core/memory)', () => {
    const matches = teamSrc.match(/\{\s*name:\s*'/g);
    assert.equal(matches.length, 15);
  });

  it('should call startEventFeed for RuminationEngine postInit', () => {
    assert.ok(teamSrc.includes('inst.startEventFeed()'));
  });

  it('should subscribe GoTReasoner to knowledge:rumination:digested', () => {
    assert.ok(teamSrc.includes("'knowledge:rumination:digested'"));
  });
});

// ── VaultBridge graceful degradation ─────────────────────────

describe('VaultBridge — graceful degradation', () => {
  const { VaultBridge } = require('../agent/memory/vault-bridge');

  it('should disable when OBSIDIAN_API_KEY is empty', async () => {
    const bridge = new VaultBridge({ obsidianToken: '' });
    bridge.board = {
      connect: async () => {},
      client: { isOpen: false },
      createSubscriber: async () => ({
        on: () => {},
        subscribe: async () => {},
        disconnect: async () => {},
      }),
    };
    await bridge.init();
    assert.equal(bridge.enabled, false);
  });

  it('should enable when OBSIDIAN_API_KEY is set', async () => {
    const bridge = new VaultBridge({ obsidianToken: 'test-token' });
    bridge.board = {
      connect: async () => {},
      client: { isOpen: false },
      createSubscriber: async () => ({
        on: () => {},
        subscribe: async () => {},
        disconnect: async () => {},
      }),
    };
    await bridge.init();
    assert.equal(bridge.enabled, true);
  });

  it('should skip start() when disabled', async () => {
    const bridge = new VaultBridge({ obsidianToken: '' });
    bridge.board = {
      connect: async () => {},
      client: { isOpen: false },
      createSubscriber: async () => {
        throw new Error('should not be called');
      },
    };
    await bridge.init();
    await bridge.start(); // should not throw
  });

  it('should create subscriber when enabled', async () => {
    let subscribed = false;
    const bridge = new VaultBridge({ obsidianToken: 'test-token' });
    bridge.board = {
      connect: async () => {},
      client: { isOpen: false },
      createSubscriber: async () => ({
        on: () => {},
        subscribe: async () => { subscribed = true; },
        disconnect: async () => {},
      }),
    };
    await bridge.init();
    await bridge.start();
    assert.ok(subscribed);
  });

  it('should shutdown cleanly with subscriber', async () => {
    let disconnected = false;
    const bridge = new VaultBridge({ obsidianToken: 'test-token' });
    bridge.subscriber = { disconnect: async () => { disconnected = true; } };
    bridge.board = { disconnect: async () => {}, client: null };
    await bridge.shutdown();
    assert.ok(disconnected);
  });

  it('should shutdown cleanly without subscriber', async () => {
    const bridge = new VaultBridge({ obsidianToken: '' });
    bridge.board = { disconnect: async () => {}, client: null };
    await bridge.shutdown(); // should not throw
  });
});

// ── RuminationEngine event feed ──────────────────────────────

describe('RuminationEngine — startEventFeed', () => {
  const { RuminationEngine } = require('../agent/memory/rumination-engine');

  function createMockZK() {
    return {
      getAllNotes: async () => ({}),
      _linkKey: (a, b) => [a, b].sort().join('::'),
      recordUsage: async () => ({ tierUp: false }),
      getNote: async () => null,
      board: { setHashField: async () => {} },
      _writeVaultNote: async () => {},
    };
  }

  it('should subscribe to knowledge:capture:stored and work:dry-run:recorded', async () => {
    const engine = new RuminationEngine(createMockZK());
    const subscriptions = {};

    engine.board = {
      connect: async () => {},
      disconnect: async () => {},
      publish: async () => {},
      createSubscriber: async () => ({
        on: () => {},
        subscribe: async (ch, cb) => { subscriptions[ch] = cb; },
        disconnect: async () => {},
      }),
    };

    await engine.startEventFeed();

    assert.ok(subscriptions['knowledge:capture:stored']);
    assert.ok(subscriptions['work:dry-run:recorded']);
    const subscribedCb = subscriptions['knowledge:capture:stored'];

    // Simulate a capture event
    subscribedCb(JSON.stringify({
      title: 'Completed task-1',
      outcome: 'passed',
      projectId: 'proj-1',
      taskId: 'task-1',
    }));

    assert.equal(engine.rawBuffer.length, 1);
    assert.equal(engine.rawBuffer[0].succeeded, true);
    assert.equal(engine.rawBuffer[0].source, 'knowledge-capture');
    assert.equal(engine.rawBuffer[0].projectId, 'proj-1');
  });

  it('should handle malformed messages gracefully', async () => {
    const engine = new RuminationEngine(createMockZK());
    const subs = {};

    engine.board = {
      connect: async () => {},
      disconnect: async () => {},
      publish: async () => {},
      createSubscriber: async () => ({
        on: () => {},
        subscribe: async (ch, cb) => { subs[ch] = cb; },
        disconnect: async () => {},
      }),
    };

    await engine.startEventFeed();

    // Invalid JSON should not throw
    subs['knowledge:capture:stored']('not-json{{{');
    assert.equal(engine.rawBuffer.length, 0);
  });

  it('should handle object messages directly', async () => {
    const engine = new RuminationEngine(createMockZK());
    const subs = {};

    engine.board = {
      connect: async () => {},
      disconnect: async () => {},
      publish: async () => {},
      createSubscriber: async () => ({
        on: () => {},
        subscribe: async (ch, cb) => { subs[ch] = cb; },
        disconnect: async () => {},
      }),
    };

    await engine.startEventFeed();

    subs['knowledge:capture:stored']({ title: 'Test', outcome: 'failed', projectId: 'p' });
    assert.equal(engine.rawBuffer.length, 1);
    assert.equal(engine.rawBuffer[0].succeeded, false);
  });

  it('should feed dry-run results as experiences', async () => {
    const engine = new RuminationEngine(createMockZK());
    const subs = {};

    engine.board = {
      connect: async () => {},
      disconnect: async () => {},
      publish: async () => {},
      createSubscriber: async () => ({
        on: () => {},
        subscribe: async (ch, cb) => { subs[ch] = cb; },
        disconnect: async () => {},
      }),
    };

    await engine.startEventFeed();

    subs['work:dry-run:recorded'](JSON.stringify({
      summary: 'Test dry run',
      outcome: 'passed',
      projectId: 'p1',
      taskId: 't1',
    }));

    assert.equal(engine.rawBuffer.length, 1);
    assert.equal(engine.rawBuffer[0].source, 'dry-run');
    assert.equal(engine.rawBuffer[0].succeeded, true);
  });

  it('should disconnect event subscriber on shutdown', async () => {
    const engine = new RuminationEngine(createMockZK());
    let eventDisconnected = false;
    let boardDisconnected = false;

    engine.eventSubscriber = { disconnect: async () => { eventDisconnected = true; } };
    engine.board = { disconnect: async () => { boardDisconnected = true; } };

    await engine.shutdown();

    assert.ok(eventDisconnected);
    assert.ok(boardDisconnected);
  });
});

// ── GoTReasoner event-based trigger ──────────────────────────

describe('GoTReasoner — event-driven trigger', () => {
  const { GoTReasoner } = require('../agent/memory/got-reasoner');

  function createMockZK(notes = {}) {
    return {
      getAllNotes: async () => notes,
      _linkKey: (a, b) => [a, b].sort().join('::'),
      recordUsage: async () => ({ tierUp: false }),
      getNote: async (id) => notes[id] || null,
      board: { setHashField: async () => {} },
      _writeVaultNote: async () => {},
    };
  }

  it('should disconnect _eventSubscriber on shutdown', async () => {
    const got = new GoTReasoner(createMockZK());
    let eventDisconnected = false;
    let boardDisconnected = false;

    got._eventSubscriber = { disconnect: async () => { eventDisconnected = true; } };
    got.board = { disconnect: async () => { boardDisconnected = true; } };

    await got.shutdown();

    assert.ok(eventDisconnected);
    assert.ok(boardDisconnected);
  });

  it('should shutdown cleanly without _eventSubscriber', async () => {
    const got = new GoTReasoner(createMockZK());
    got.board = { disconnect: async () => {} };

    await got.shutdown(); // should not throw
  });
});
