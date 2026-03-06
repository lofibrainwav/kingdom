const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { DeployerAgent } = require('../agent/team/deployer');

describe('DeployerAgent', () => {
  let configs;
  let published;
  let statuses;
  let board;
  let agent;
  let execSyncCalls;

  beforeEach(() => {
    configs = new Map();
    published = [];
    statuses = [];
    execSyncCalls = [];

    board = {
      connect: async () => {},
      disconnect: async () => {},
      createSubscriber: async () => ({
        on: () => {},
        subscribe: async () => {},
        disconnect: async () => {},
      }),
      setConfig: async (key, value) => {
        configs.set(key, value);
      },
      getConfig: async (key) => configs.get(key) || null,
      publish: async (channel, data) => {
        published.push({ channel, data });
      },
      updateStatus: async (agentId, status) => {
        statuses.push({ agentId, status });
      },
    };

    agent = new DeployerAgent();
    agent.board = board;

    // Monkey-patch handleProjectApproved to intercept execSync
    const origHandle = agent.handleProjectApproved.bind(agent);
    agent.handleProjectApproved = async function (message) {
      const cp = require('child_process');
      const origExecSync = cp.execSync;
      cp.execSync = (cmd, opts) => { execSyncCalls.push({ cmd, opts }); };
      try {
        await origHandle(message);
      } finally {
        cp.execSync = origExecSync;
      }
    };
  });

  it('init subscribes to governance:project:approved and sets idle status', async () => {
    let subscribedChannel = null;
    board.createSubscriber = async () => ({
      on: () => {},
      subscribe: async (channel) => { subscribedChannel = channel; },
      disconnect: async () => {},
    });

    await agent.init();

    assert.equal(subscribedChannel, 'governance:project:approved');
    assert.equal(statuses.at(-1).agentId, 'Kingdom_Deployer');
    assert.equal(statuses.at(-1).status.state, 'idle');
  });

  it('handleProjectApproved runs git commands and publishes deployment event', async () => {
    await agent.handleProjectApproved({
      projectId: 'project:deploy-01',
      goal: 'Ship the API',
    });

    // execSync was called with git add/commit/push
    assert.equal(execSyncCalls.length, 1);
    assert.ok(execSyncCalls[0].cmd.includes('git add'));
    assert.ok(execSyncCalls[0].cmd.includes('git commit'));
    assert.ok(execSyncCalls[0].cmd.includes('git push'));

    // Status saved to blackboard
    assert.equal(configs.get('project:deploy-01:status'), 'deployed');

    // Deployment event published
    assert.equal(published.length, 1);
    assert.equal(published[0].channel, 'execution:deployment:completed');
    assert.equal(published[0].data.projectId, 'project:deploy-01');
    assert.equal(published[0].data.status, 'success');

    // Status: deploying -> idle
    assert.equal(statuses[0].status.state, 'deploying');
    assert.equal(statuses.at(-1).status.state, 'idle');
  });

  it('handleProjectApproved sets error status on failure', async () => {
    const cp = require('child_process');
    const origHandle = DeployerAgent.prototype.handleProjectApproved;

    // Re-create agent without the monkey-patch to test error path
    const rawAgent = new DeployerAgent();
    rawAgent.board = board;

    // Patch execSync to throw
    const origExecSync = cp.execSync;
    cp.execSync = () => { throw new Error('git push failed'); };

    try {
      await origHandle.call(rawAgent, {
        projectId: 'project:fail-01',
        goal: 'Bad deploy',
      });
    } finally {
      cp.execSync = origExecSync;
    }

    assert.equal(statuses.at(-1).status.state, 'error');
    assert.ok(statuses.at(-1).status.task.includes('Deployment failed'));
  });

  it('shutdown disconnects subscriber and board', async () => {
    let subDisconnected = false;
    let boardDisconnected = false;

    agent.subscriber = { disconnect: async () => { subDisconnected = true; } };
    board.disconnect = async () => { boardDisconnected = true; };

    await agent.shutdown();

    assert.ok(subDisconnected);
    assert.ok(boardDisconnected);
  });
});
