const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { DecomposerAgent } = require('../agent/team/decomposer');

describe('DecomposerAgent', () => {
  let configs;
  let published;
  let statuses;
  let board;
  let llm;
  let got;
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
      callLLM: async () => ({ tasks: [{ id: 'T1', description: 'Setup', dependencyId: null }] }),
    };

    got = {
      init: async () => {},
      resolveSynergy: async () => ({ nodes: ['setup', 'build'], edges: [] }),
    };

    agent = new DecomposerAgent();
    agent.board = board;
    agent.llm = llm;
    agent.got = got;
  });

  it('init subscribes to work:planning:designed and sets idle status', async () => {
    let subscribedChannel = null;
    board.createSubscriber = async () => ({
      on: () => {},
      subscribe: async (channel) => { subscribedChannel = channel; },
      disconnect: async () => {},
    });

    await agent.init();

    assert.equal(subscribedChannel, 'work:planning:designed');
    assert.equal(statuses.at(-1).agentId, 'Kingdom_Decomposer');
    assert.equal(statuses.at(-1).status.state, 'idle');
  });

  it('handleDesignComplete uses GoT + LLM and publishes decomposed tasks', async () => {
    let gotCalled = false;
    let llmCalled = false;

    got.resolveSynergy = async (goal, arch) => {
      gotCalled = true;
      assert.equal(goal, 'Build a CLI tool');
      return { nodes: ['parse', 'execute'], edges: [{ from: 'parse', to: 'execute' }] };
    };

    llm.callLLM = async () => {
      llmCalled = true;
      return { tasks: [
        { id: 'T1', description: 'Parse CLI args', dependencyId: null },
        { id: 'T2', description: 'Execute commands', dependencyId: 'T1' },
      ]};
    };

    await agent.handleDesignComplete({
      projectId: 'project:cli-01',
      goal: 'Build a CLI tool',
      architecture: 'Node.js CLI with commander',
    });

    assert.ok(gotCalled);
    assert.ok(llmCalled);

    // Saves tasks to blackboard
    const taskData = configs.get('project:cli-01:tasks');
    assert.equal(taskData.status, 'decomposed');

    // Publishes to coder
    assert.equal(published.length, 1);
    assert.equal(published[0].channel, 'work:planning:decomposed');
    assert.equal(published[0].data.projectId, 'project:cli-01');

    // Status: decomposing -> idle
    assert.equal(statuses[0].status.state, 'decomposing');
    assert.equal(statuses.at(-1).status.state, 'idle');
  });

  it('handleDesignComplete forwards retry context', async () => {
    await agent.handleDesignComplete({
      projectId: 'project:retry-02',
      goal: 'Fix parsing',
      architecture: 'Node.js',
      taskId: 'TASK-42',
      retry: true,
      retryCategory: 'task',
      retryGuardrail: 'no-regex',
    });

    const taskData = configs.get('project:retry-02:tasks');
    assert.equal(taskData.taskId, 'TASK-42');
    assert.equal(taskData.retry, true);

    assert.equal(published[0].data.retry, true);
    assert.equal(published[0].data.retryGuardrail, 'no-regex');
  });

  it('shutdown disconnects subscriber, board, and LLM', async () => {
    let subDisconnected = false;
    let boardDisconnected = false;
    let llmShutdown = false;

    agent.subscriber = { disconnect: async () => { subDisconnected = true; } };
    board.disconnect = async () => { boardDisconnected = true; };
    llm.shutdown = async () => { llmShutdown = true; };

    await agent.shutdown();

    assert.ok(subDisconnected);
    assert.ok(boardDisconnected);
    assert.ok(llmShutdown);
  });
});
