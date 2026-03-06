const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { WatchdogAgent } = require('../agent/team/watchdog-agent');

describe('WatchdogAgent', () => {
  let statuses;
  let published;
  let board;
  let agent;
  let execCalls;

  beforeEach(() => {
    statuses = [];
    published = [];
    execCalls = [];

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

    // Monkey-patch exec to track recovery attempts
    const cp = require('child_process');
    const origExec = cp.exec;
    cp.exec = (cmd, cb) => { execCalls.push(cmd); if (cb) cb(null); };

    try {
      await agent.checkSystemHealth();
    } finally {
      cp.exec = origExec;
    }

    // No recovery attempts for healthy agents
    assert.equal(execCalls.length, 0);
    assert.equal(published.length, 0);
  });

  it('checkSystemHealth triggers recovery for unresponsive agents', async () => {
    const staleTime = Date.now() - 120000; // 2 minutes ago
    board.getAllStatuses = async () => ({
      'Kingdom_Watchdog': { lastUpdate: Date.now(), state: 'active' },
      'Kingdom_PM': { lastUpdate: staleTime, state: 'idle' },
    });

    const cp = require('child_process');
    const origExec = cp.exec;
    cp.exec = (cmd, cb) => { execCalls.push(cmd); if (cb) cb(null); };

    try {
      await agent.checkSystemHealth();
    } finally {
      cp.exec = origExec;
    }

    // Recovery triggered for PM
    assert.equal(execCalls.length, 1);
    assert.ok(execCalls[0].includes('pm-agent.js'));

    // Recovery event published
    assert.equal(published.length, 1);
    assert.equal(published[0].channel, 'governance:watchdog:recovery');
    assert.equal(published[0].data.agentId, 'Kingdom_PM');
    assert.equal(published[0].data.action, 'restart');
  });

  it('recoverAgent maps agent IDs to correct script files', async () => {
    const cp = require('child_process');
    const origExec = cp.exec;
    cp.exec = (cmd, cb) => { execCalls.push(cmd); if (cb) cb(null); };

    try {
      await agent.recoverAgent('Kingdom_Architect');
      await agent.recoverAgent('Kingdom_Coder');
      await agent.recoverAgent('Kingdom_Swarm');
    } finally {
      cp.exec = origExec;
    }

    assert.equal(execCalls.length, 3);
    assert.ok(execCalls[0].includes('architect.js'));
    assert.ok(execCalls[1].includes('coder.js'));
    assert.ok(execCalls[2].includes('swarm-orchestrator.js'));
  });

  it('shutdown clears timer and disconnects board', async () => {
    let boardDisconnected = false;
    board.disconnect = async () => { boardDisconnected = true; };

    await agent.init();
    assert.ok(agent.timer);

    await agent.shutdown();
    assert.ok(boardDisconnected);
  });
});
