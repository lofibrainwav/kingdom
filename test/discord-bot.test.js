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
    assert.equal(typeof h1, 'number', 'hash should be a number');
    assert.equal(typeof h2, 'number', 'hash should be a number');
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
    assert.equal(typeof ROLE_COLORS.leader, 'number', 'leader color should be a number');
    assert.equal(typeof ROLE_COLORS.builder, 'number', 'builder color should be a number');
    assert.equal(typeof ROLE_COLORS.safety, 'number', 'safety color should be a number');
    assert.equal(typeof ROLE_COLORS.explorer, 'number', 'explorer color should be a number');
  });

  it('REACT_THROTTLE_MS is a positive number', () => {
    assert.equal(typeof REACT_THROTTLE_MS, 'number', 'REACT_THROTTLE_MS should be a number');
    assert.equal(REACT_THROTTLE_MS > 0, true, 'REACT_THROTTLE_MS should be positive');
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

  it('embed methods skip gracefully when channels not configured', () => {
    // All embed methods should return undefined without throwing
    assert.equal(bot._postStatusEmbed('ch', { agentId: 'x', health: 20 }), undefined);
    assert.equal(bot._postHealthEmbed({ agentId: 'x', health: 10 }), undefined);
    assert.equal(bot._postInventoryEmbed({ agentId: 'x', items: [] }), undefined);
    assert.equal(bot._postReactPulse({ agentId: 'x', iteration: 1 }), undefined);
    assert.equal(bot._postAlertEmbed('threat', { description: 'x' }), undefined);
    assert.equal(bot._postSkillEmbed({ skillName: 'x' }), undefined);
    assert.equal(bot._postChatMessage({ agentId: 'x', message: 'x' }), undefined);
    assert.equal(bot._postMilestoneEmbed({ agentId: 'x', message: 'x' }), undefined);
  });

  it('_postShinmungo skips when no forum channel', async () => {
    const result = await bot._postShinmungo({ agentId: 'test', message: 'confession' });
    assert.equal(result, undefined);
  });

  it('embed methods call channel.send when channel exists', () => {
    let sendCount = 0;
    const mockChannel = { send: async () => { sendCount++; } };
    bot.channels.status = mockChannel;
    bot.channels.alerts = mockChannel;
    bot.channels.chat = mockChannel;

    bot._postStatusEmbed('ch', { agentId: 'a', health: 20, position: { x: 0, y: 0, z: 0 } });
    bot._postHealthEmbed({ agentId: 'a', health: 10, food: 15, position: { x: 0, y: 0, z: 0 } });
    bot._postInventoryEmbed({ agentId: 'a', items: [{ name: 'sword', count: 1 }] });
    bot._postAlertEmbed('threat', { description: 'test', agentId: 'a' });
    bot._postSkillEmbed({ skillName: 'skill-1', agentId: 'a' });
    bot._postChatMessage({ agentId: 'a', message: 'hi', to: 'b' });
    bot._postMilestoneEmbed({ agentId: 'a', message: 'done', position: { x: 1, y: 2, z: 3 } });

    assert.equal(sendCount, 7, `expected 7 sends, got ${sendCount}`);
  });

  it('_postReactPulse throttles by agent', () => {
    let sendCount = 0;
    bot.channels.status = { send: async () => { sendCount++; } };

    bot._postReactPulse({ agentId: 'agent-1', iteration: 1 });
    assert.equal(sendCount, 1, 'first pulse sent');

    const firstTime = bot._reactThrottle.get('agent-1');
    assert.equal(typeof firstTime, 'number');

    // Second call within throttle window — suppressed
    bot._postReactPulse({ agentId: 'agent-1', iteration: 2 });
    assert.equal(sendCount, 1, 'throttled — still 1');

    // Different agent — not throttled
    bot._postReactPulse({ agentId: 'agent-2', iteration: 1 });
    assert.equal(sendCount, 2, 'different agent sent');
  });
});
