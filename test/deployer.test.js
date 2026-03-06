const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { DeployerAgent } = require('../agent/team/deployer');

describe('DeployerAgent', () => {
  let configs;
  let published;
  let statuses;
  let board;
  let agent;

  beforeEach(() => {
    configs = new Map();
    published = [];
    statuses = [];

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

  it('handleProjectApproved sets error status when git commands fail', async () => {
    // execSync is destructured at module level, so it will fail
    // trying to run real git commands — this tests the error path
    await agent.handleProjectApproved({
      projectId: 'project:fail-01',
      goal: 'Bad deploy',
    });

    // The deploying status is set first, then error on execSync failure
    assert.equal(statuses[0].status.state, 'deploying');
    assert.equal(statuses.at(-1).status.state, 'error');
    assert.ok(statuses.at(-1).status.task.includes('Deployment failed'));
  });

  it('handleProjectApproved parses string messages', async () => {
    await agent.handleProjectApproved(JSON.stringify({
      projectId: 'project:str-01',
      goal: 'String parse test',
    }));

    // Should still attempt deployment (and fail at execSync)
    assert.equal(statuses[0].status.state, 'deploying');
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
