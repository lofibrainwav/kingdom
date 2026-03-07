const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { WatchdogAgent } = require('../agent/team/watchdog-agent');

describe('WatchdogAgent', () => {
  let statuses;
  let published;
  let board;
  let agent;

  beforeEach(() => {
    statuses = [];
    published = [];

    board = {
      connect: async () => {},
      disconnect: async () => {},
      getAllStatuses: async () => ({}),
      publish: async (channel, data) => {
        published.push({ channel, data });
      },
      updateStatus: async (agentId, status) => {
        statuses.push({ agentId, status });
      },
    };

    agent = new WatchdogAgent();
    agent.board = board;
    // Prevent real timers from firing in tests
    agent.checkInterval = 999999;
  });

  afterEach(async () => {
    await agent.shutdown();
  });

  it('init connects board, starts timer, and sets active status', async () => {
    await agent.init();

    assert.ok(agent.timer);
    assert.equal(statuses.at(-1).agentId, 'Kingdom_Watchdog');
    assert.equal(statuses.at(-1).status.state, 'active');
  });

  it('checkSystemHealth skips self and ignores healthy agents', async () => {
    board.getAllStatuses = async () => ({
      'Kingdom_Watchdog': { lastUpdate: Date.now(), state: 'active' },
      'Kingdom_PM': { lastUpdate: Date.now(), state: 'idle' },
      'Kingdom_Coder': { lastUpdate: Date.now(), state: 'coding' },
    });

    // Mock recoverAgent to detect calls
    let recoverCalls = [];
    agent.recoverAgent = async (id) => { recoverCalls.push(id); };

    await agent.checkSystemHealth();

    // No recovery attempts for healthy agents
    assert.equal(recoverCalls.length, 0);
  });

  it('checkSystemHealth triggers recovery for unresponsive agents', async () => {
    const staleTime = Date.now() - 120000; // 2 minutes ago
    board.getAllStatuses = async () => ({
      'Kingdom_Watchdog': { lastUpdate: Date.now(), state: 'active' },
      'Kingdom_PM': { lastUpdate: staleTime, state: 'idle' },
      'Kingdom_Architect': { lastUpdate: staleTime, state: 'designing' },
    });

    let recoverCalls = [];
    agent.recoverAgent = async (id) => { recoverCalls.push(id); };

    await agent.checkSystemHealth();

    // Recovery triggered for PM and Architect
    assert.equal(recoverCalls.length, 2);
    assert.ok(recoverCalls.includes('Kingdom_PM'));
    assert.ok(recoverCalls.includes('Kingdom_Architect'));
  });

  it('recoverAgent publishes recovery event for known agents', async () => {
    // exec is destructured at module level, so it will try to spawn real processes.
    // We test the observable side effect: the governance:watchdog:recovery publish.
    // exec runs async with a callback, so it won't block or throw.
    await agent.recoverAgent('Kingdom_PM');

    assert.equal(published.length, 1);
    assert.equal(published[0].channel, 'governance:watchdog:recovery');
    assert.equal(published[0].data.agentId, 'Kingdom_PM');
    assert.equal(published[0].data.action, 'restart');
  });

  it('recoverAgent does nothing for unknown agent IDs', async () => {
    await agent.recoverAgent('Unknown_Agent');

    // No publish for unknown agents (nameMap lookup returns undefined)
    assert.equal(published.length, 0);
  });

  it('shutdown clears timer and disconnects board', async () => {
    let boardDisconnected = false;
    board.disconnect = async () => { boardDisconnected = true; };

    await agent.init();
    assert.equal(!!agent.timer, true);

    await agent.shutdown();
    assert.equal(boardDisconnected, true);
  });
});
