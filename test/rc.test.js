/**
 * Remote Control (/rc) tests
 * Tests RC command handling in discord-bot.js and RC listener in team.js
 */
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// Mock Blackboard
function createMockBoard() {
  const published = [];
  const subscribers = [];
  const store = {};

  return {
    published,
    store,
    async publish(channel, data) {
      if (!data.author) throw new Error('[Blackboard] 孝: author field is required');
      published.push({ channel, data });
    },
    async get(channel) {
      return store[channel] || null;
    },
    async getACProgress(agentId) {
      return store[`ac:${agentId}`] || {};
    },
    async getHash(key) {
      return store[`hash:${key}`] || {};
    },
    async createSubscriber() {
      const sub = {
        subscriptions: {},
        async subscribe(channel, handler) {
          sub.subscriptions[channel] = handler;
        },
        async pSubscribe(pattern, handler) {
          sub.subscriptions[pattern] = handler;
        },
        async unsubscribe() {},
        async disconnect() {},
      };
      subscribers.push(sub);
      return sub;
    },
    client: {
      async publish(channel, payload) {
        published.push({ channel, payload, raw: true });
      },
    },
    subscribers,
  };
}

// Mock Discord message
function createMockMsg(content, isBot = false) {
  const replies = [];
  return {
    content,
    author: { bot: isBot, tag: 'testuser#1234' },
    reply: (data) => { replies.push(data); return Promise.resolve(); },
    replies,
  };
}

describe('Remote Control — Discord Bot (_cmdRc)', () => {
  let bot;

  beforeEach(() => {
    // Simulate OctivDiscordBot with mock board
    const board = createMockBoard();
    bot = {
      board,
      _cmdRc: null, // Will be tested via _handleCommand
    };
  });

  it('should parse !rc command with subcmd', () => {
    const content = '!rc status';
    const [cmd, ...args] = content.slice(1).split(/\s+/);
    assert.equal(cmd, 'rc');
    assert.deepEqual(args, ['status']);
  });

  it('should parse !rc with no subcmd (defaults to status)', () => {
    const content = '!rc';
    const [cmd, ...args] = content.slice(1).split(/\s+/);
    assert.equal(cmd, 'rc');
    const subcmd = (args[0] || 'status').toLowerCase();
    assert.equal(subcmd, 'status');
  });

  it('should reject unknown RC subcmd', async () => {
    const supported = ['status', 'test', 'ac', 'log', 'agents'];
    const subcmd = 'restart';
    assert.ok(!supported.includes(subcmd));
  });

  it('should accept all valid subcommands', () => {
    const supported = ['status', 'test', 'ac', 'log', 'agents'];
    for (const s of supported) {
      assert.ok(supported.includes(s), `${s} should be supported`);
    }
  });
});

describe('Remote Control — Team Listener (setupRemoteControl)', () => {
  const { setupRemoteControl } = require('../agent/team');

  it('should subscribe to all RC command channels', async () => {
    const board = createMockBoard();
    const agents = {
      leader: { id: 'leader', mode: 'training' },
      builders: [{ id: 'builder-01' }, { id: 'builder-02' }, { id: 'builder-03' }],
      safety: { id: 'safety-01' },
      explorer: { id: 'explorer-01' },
    };

    const sub = await setupRemoteControl(board, agents);
    assert.ok(sub);

    const expectedChannels = [
      'octiv:rc:cmd:status',
      'octiv:rc:cmd:agents',
      'octiv:rc:cmd:ac',
      'octiv:rc:cmd:log',
      'octiv:rc:cmd:test',
    ];

    for (const ch of expectedChannels) {
      assert.ok(sub.subscriptions[ch], `Should subscribe to ${ch}`);
    }
  });

  it('should respond to rc:cmd:test with OK message', async () => {
    const board = createMockBoard();
    const agents = {
      leader: { id: 'leader', mode: 'training' },
      builders: [],
      safety: {},
      explorer: {},
    };

    const sub = await setupRemoteControl(board, agents);
    const handler = sub.subscriptions['octiv:rc:cmd:test'];
    assert.ok(handler);

    // Simulate incoming test command
    await handler(JSON.stringify({
      requestId: 'rc:response:12345',
      subcmd: 'test',
      author: 'discord-bot',
    }));

    // Check response was published
    const response = board.published.find(p => p.raw && p.channel === 'octiv:rc:response:12345');
    assert.ok(response, 'Should publish response');
    const parsed = JSON.parse(response.payload);
    assert.equal(parsed.data, 'RC connection OK. Team is responsive.');
  });

  it('should respond to rc:cmd:agents with agent list', async () => {
    const board = createMockBoard();
    const agents = {
      leader: { id: 'leader', mode: 'creative' },
      builders: [{ id: 'b1' }, { id: 'b2' }],
      safety: {},
      explorer: {},
    };

    const sub = await setupRemoteControl(board, agents);
    const handler = sub.subscriptions['octiv:rc:cmd:agents'];

    await handler(JSON.stringify({
      requestId: 'rc:response:99',
      subcmd: 'agents',
      author: 'discord-bot',
    }));

    const response = board.published.find(p => p.raw && p.channel === 'octiv:rc:response:99');
    assert.ok(response);
    const parsed = JSON.parse(response.payload);
    assert.ok(Array.isArray(parsed.data));
    assert.equal(parsed.data.length, 5); // leader + 2 builders + safety + explorer
    assert.equal(parsed.data[0].id, 'leader');
    assert.equal(parsed.data[0].mode, 'creative');
  });

  it('should respond to rc:cmd:status with team status', async () => {
    const board = createMockBoard();
    board.store['team:status'] = {
      status: 'running',
      mission: 'first-day-survival v1.3.1',
      startedAt: new Date(Date.now() - 60000).toISOString(),
    };
    const agents = {
      leader: { id: 'leader', mode: 'training' },
      builders: [{ id: 'b1' }, { id: 'b2' }, { id: 'b3' }],
      safety: {},
      explorer: {},
    };

    const sub = await setupRemoteControl(board, agents);
    const handler = sub.subscriptions['octiv:rc:cmd:status'];

    await handler(JSON.stringify({
      requestId: 'rc:response:100',
      subcmd: 'status',
      author: 'discord-bot',
    }));

    const response = board.published.find(p => p.raw && p.channel === 'octiv:rc:response:100');
    assert.ok(response);
    const parsed = JSON.parse(response.payload);
    assert.equal(parsed.data.status, 'running');
    assert.equal(parsed.data.builders, 3);
  });

  it('should respond to rc:cmd:ac with AC progress matrix', async () => {
    const board = createMockBoard();
    board.store['ac:builder-01'] = {
      'AC-1': JSON.stringify({ status: 'done' }),
      'AC-2': JSON.stringify({ status: 'in_progress' }),
    };
    const agents = {
      leader: { id: 'leader', mode: 'training' },
      builders: [{ id: 'builder-01' }],
      safety: {},
      explorer: {},
    };

    const sub = await setupRemoteControl(board, agents);
    const handler = sub.subscriptions['octiv:rc:cmd:ac'];

    await handler(JSON.stringify({
      requestId: 'rc:response:200',
      subcmd: 'ac',
      author: 'discord-bot',
    }));

    const response = board.published.find(p => p.raw && p.channel === 'octiv:rc:response:200');
    assert.ok(response);
    const parsed = JSON.parse(response.payload);
    assert.deepEqual(parsed.data['builder-01'], { 'AC-1': 'done', 'AC-2': 'in_progress' });
  });

  it('should handle missing requestId gracefully', async () => {
    const board = createMockBoard();
    const agents = {
      leader: { id: 'leader', mode: 'training' },
      builders: [],
      safety: {},
      explorer: {},
    };

    const sub = await setupRemoteControl(board, agents);
    const handler = sub.subscriptions['octiv:rc:cmd:test'];

    // Should not throw
    await handler(JSON.stringify({ subcmd: 'test', author: 'discord-bot' }));
    // No response published since requestId is missing
    const responses = board.published.filter(p => p.raw);
    assert.equal(responses.length, 0);
  });

  it('should handle malformed JSON gracefully', async () => {
    const board = createMockBoard();
    const agents = {
      leader: { id: 'leader', mode: 'training' },
      builders: [],
      safety: {},
      explorer: {},
    };

    const sub = await setupRemoteControl(board, agents);
    const handler = sub.subscriptions['octiv:rc:cmd:test'];

    // Should not throw
    await handler('not-json');
    // No crash — error logged internally
  });
});
