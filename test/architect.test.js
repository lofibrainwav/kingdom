const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { ArchitectAgent } = require('../agent/team/architect');

describe('ArchitectAgent', () => {
  let configs;
  let published;
  let statuses;
  let board;
  let llm;
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

    llm = {
      init: async () => {},
      shutdown: async () => {},
      callLLM: async () => 'mock architecture design',
    };

    agent = new ArchitectAgent();
    agent.board = board;
    agent.llm = llm;
  });

  it('init subscribes to work:planning:init and sets idle status', async () => {
    let subscribedChannel = null;
    board.createSubscriber = async () => ({
      on: () => {},
      subscribe: async (channel) => { subscribedChannel = channel; },
      disconnect: async () => {},
    });

    await agent.init();

    assert.equal(subscribedChannel, 'work:planning:init');
    assert.equal(statuses.at(-1).agentId, 'Kingdom_Architect');
    assert.equal(statuses.at(-1).status.state, 'idle');
  });

  it('handleProjectInit generates architecture and publishes designed event', async () => {
    llm.callLLM = async (prompt) => {
      assert.ok(prompt.includes('Build a dashboard'));
      return 'React + Express architecture';
    };

    await agent.handleProjectInit({
      projectId: 'project:dash-01',
      goal: 'Build a dashboard',
    });

    // Saves architecture to blackboard
    const arch = configs.get('project:dash-01:architecture');
    assert.equal(arch.design, 'React + Express architecture');
    assert.equal(arch.status, 'designed');
    assert.equal(arch.retry, false);

    // Publishes to decomposer
    assert.equal(published.length, 1);
    assert.equal(published[0].channel, 'work:planning:designed');
    assert.equal(published[0].data.projectId, 'project:dash-01');
    assert.equal(published[0].data.architecture, 'React + Express architecture');

    // Status updates: designing -> idle
    assert.equal(statuses[0].status.state, 'designing');
    assert.equal(statuses[1].status.state, 'idle');
  });

  it('handleProjectInit forwards retry context', async () => {
    await agent.handleProjectInit({
      projectId: 'project:retry-01',
      goal: 'Fix auth',
      taskId: 'TASK-99',
      retry: true,
      retryCategory: 'skill',
      retryGuardrail: 'no-hardcode',
    });

    const arch = configs.get('project:retry-01:architecture');
    assert.equal(arch.taskId, 'TASK-99');
    assert.equal(arch.retry, true);
    assert.equal(arch.retryCategory, 'skill');
    assert.equal(arch.retryGuardrail, 'no-hardcode');

    assert.equal(published[0].data.retry, true);
    assert.equal(published[0].data.retryGuardrail, 'no-hardcode');
  });

  it('shutdown disconnects subscriber, board, and LLM', async () => {
    let subDisconnected = false;
    let boardDisconnected = false;
    let llmShutdown = false;

    agent.subscriber = { disconnect: async () => { subDisconnected = true; } };
    board.disconnect = async () => { boardDisconnected = true; };
    llm.shutdown = async () => { llmShutdown = true; };

    await agent.shutdown();

    assert.equal(subDisconnected, true);
    assert.equal(boardDisconnected, true);
    assert.equal(llmShutdown, true);
  });
});
