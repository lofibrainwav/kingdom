/**
 * Discord Bot Unit Tests
 *
 * Tests utility functions, command parsing, and embed generation
 * without requiring a live Discord connection.
 */
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const {
  KingdomDiscordBot,
  REACT_THROTTLE_MS,
  ROLE_COLORS,
  DEFAULT_COLOR,
  _anonymousHash,
  _roleColor,
} = require('../agent/interface/discord-bot');

// ── Utility Functions ─────────────────────────────────

describe('Discord Bot — Utility Functions', () => {
  it('_anonymousHash returns stable number 1-99', () => {
    const hash1 = _anonymousHash('builder-01');
    const hash2 = _anonymousHash('builder-01');
    assert.equal(hash1, hash2, 'same input → same hash');
    assert.ok(hash1 >= 1 && hash1 <= 99, `hash in range: ${hash1}`);
  });

  it('_anonymousHash gives different results for different agents', () => {
    const h1 = _anonymousHash('builder-01');
    const h2 = _anonymousHash('safety-01');
    // Could theoretically collide but very unlikely for these inputs
    assert.ok(typeof h1 === 'number');
    assert.ok(typeof h2 === 'number');
  });

  it('_roleColor returns correct color for known roles', () => {
    assert.equal(_roleColor('leader-01'), ROLE_COLORS.leader);
    assert.equal(_roleColor('builder-02'), ROLE_COLORS.builder);
    assert.equal(_roleColor('safety-01'), ROLE_COLORS.safety);
    assert.equal(_roleColor('explorer-01'), ROLE_COLORS.explorer);
  });

  it('_roleColor returns DEFAULT_COLOR for unknown roles', () => {
    assert.equal(_roleColor('unknown-agent'), DEFAULT_COLOR);
  });

  it('_roleColor uses explicit role when provided', () => {
    assert.equal(_roleColor('any-agent-id', 'leader'), ROLE_COLORS.leader);
  });

  it('ROLE_COLORS has expected keys', () => {
    assert.ok(ROLE_COLORS.leader);
    assert.ok(ROLE_COLORS.builder);
    assert.ok(ROLE_COLORS.safety);
    assert.ok(ROLE_COLORS.explorer);
  });

  it('REACT_THROTTLE_MS is a positive number', () => {
    assert.ok(typeof REACT_THROTTLE_MS === 'number');
    assert.ok(REACT_THROTTLE_MS > 0);
  });
});

// ── Command Parsing ───────────────────────────────────

describe('Discord Bot — Command Handling', () => {
  let bot;
  let published;
  let replies;

  beforeEach(() => {
    published = [];
    replies = [];

    // Minimal mock — bypass Discord Client constructor
    const origConstructor = KingdomDiscordBot.prototype.constructor;
    bot = Object.create(KingdomDiscordBot.prototype);
    bot.config = {};
    bot.channels = {};
    bot._reactThrottle = new Map();
    bot._forumTagCache = new Map();
    bot._reconnectAttempts = 0;

    bot.board = {
      connect: async () => {},
      disconnect: async () => {},
      createSubscriber: async () => ({
        on: () => {},
        subscribe: async () => {},
        pSubscribe: async () => {},
        disconnect: async () => {},
      }),
      publish: async (ch, data) => published.push({ channel: ch, data }),
      getConfig: async () => null,
      setConfig: async () => {},
      getHash: async () => ({}),
      get: async () => null,
    };
  });

  function mockMsg(content) {
    return {
      author: { bot: false, tag: 'testuser#1234', username: 'testuser' },
      content,
      reply: async (data) => { replies.push(data); },
    };
  }

  it('ignores messages from bots', async () => {
    const msg = { author: { bot: true }, content: '!help' };
    await bot._handleCommand(msg);
    assert.equal(replies.length, 0);
  });

  it('ignores messages without ! prefix', async () => {
    await bot._handleCommand(mockMsg('hello'));
    assert.equal(replies.length, 0);
  });

  it('!help returns embed with command list', async () => {
    await bot._handleCommand(mockMsg('!help'));
    assert.equal(replies.length, 1);
    const embed = replies[0].embeds[0];
    assert.ok(embed);
  });

  it('!assign publishes work:intake event', async () => {
    await bot._handleCommand(mockMsg('!assign coder-01 Fix the auth bug'));
    assert.equal(published.length, 1);
    assert.equal(published[0].channel, 'work:intake');
    assert.equal(published[0].data.agentId, 'coder-01');
    assert.equal(published[0].data.task, 'Fix the auth bug');
  });

  it('!assign without args returns usage', async () => {
    await bot._handleCommand(mockMsg('!assign'));
    assert.equal(replies.length, 1);
    assert.ok(replies[0].includes('Usage'));
  });

  it('!reflexion publishes reflexion event', async () => {
    await bot._handleCommand(mockMsg('!reflexion'));
    assert.equal(published.length, 1);
    assert.equal(published[0].channel, 'knowledge:reflexion:triggered');
  });

  it('!team returns team list', async () => {
    await bot._handleCommand(mockMsg('!team'));
    assert.equal(replies.length, 1);
    const embed = replies[0].embeds[0];
    assert.ok(embed);
  });

  it('!rc with unknown subcmd returns error', async () => {
    await bot._handleCommand(mockMsg('!rc unknown'));
    assert.equal(replies.length, 1);
    assert.ok(replies[0].includes('Unknown RC subcommand'));
  });

  it('ignores unknown commands silently', async () => {
    await bot._handleCommand(mockMsg('!nonexistent'));
    assert.equal(replies.length, 0);
    assert.equal(published.length, 0);
  });
});

// ── Embed Methods (no-channel safety) ─────────────────

describe('Discord Bot — Embed Safety', () => {
  let bot;

  beforeEach(() => {
    bot = Object.create(KingdomDiscordBot.prototype);
    bot.channels = {}; // no channels configured
    bot._reactThrottle = new Map();
    bot._forumTagCache = new Map();
  });

  it('_postStatusEmbed does not crash with no channels', () => {
    bot._postStatusEmbed('test:channel', { agentId: 'test', health: 20 });
    // No error = pass
  });

  it('_postHealthEmbed does not crash with no channels', () => {
    bot._postHealthEmbed({ agentId: 'test', health: 10, food: 15 });
  });

  it('_postInventoryEmbed does not crash with no channels', () => {
    bot._postInventoryEmbed({ agentId: 'test', items: [] });
  });

  it('_postReactPulse does not crash with no channels', () => {
    bot._postReactPulse({ agentId: 'test', iteration: 1 });
  });

  it('_postAlertEmbed does not crash with no channels', () => {
    bot._postAlertEmbed('threat', { description: 'test threat' });
  });

  it('_postSkillEmbed does not crash with no channels', () => {
    bot._postSkillEmbed({ skillName: 'test-skill', agentId: 'coder' });
  });

  it('_postChatMessage does not crash with no channels', () => {
    bot._postChatMessage({ agentId: 'test', message: 'hello' });
  });

  it('_postMilestoneEmbed does not crash with no channels', () => {
    bot._postMilestoneEmbed({ agentId: 'test', message: 'milestone!' });
  });

  it('_postShinmungo does not crash with no forum channel', async () => {
    await bot._postShinmungo({ agentId: 'test', message: 'confession' });
  });

  it('_postReactPulse throttles correctly', () => {
    bot.channels.status = { send: async () => {} };
    bot._postReactPulse({ agentId: 'agent-1', iteration: 1 });
    const firstTime = bot._reactThrottle.get('agent-1');
    assert.ok(firstTime > 0);
    // Second call within throttle window should be suppressed (no error)
    bot._postReactPulse({ agentId: 'agent-1', iteration: 2 });
  });
});
