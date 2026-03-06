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
      shutdown: async () => {},
      discoverSynergies: async () => ({ nodes: ['setup', 'build'], edges: [] }),
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

    got.discoverSynergies = async () => {
      gotCalled = true;
      return [{ skillA: 'parse', skillB: 'execute', score: 0.8, reason: 'complementary' }];
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

  it('handleDesignComplete parses JSON from raw LLM string response', async () => {
    llm.callLLM = async () => 'Here are the tasks:\n{ "tasks": [{ "id": "T1", "description": "Init project", "dependencyId": null }] }\nDone.';

    await agent.handleDesignComplete({
      projectId: 'project:raw-01',
      goal: 'Build something',
      architecture: 'Node.js',
    });

    assert.equal(published[0].channel, 'work:planning:decomposed');
    assert.deepEqual(published[0].data.tasks.tasks[0].id, 'T1');
  });

  it('handleDesignComplete defaults to empty task list when LLM returns unparseable response', async () => {
    llm.callLLM = async () => 'I need more information to break this down';

    await agent.handleDesignComplete({
      projectId: 'project:raw-02',
      goal: 'Vague goal',
      architecture: 'Unknown',
    });

    assert.equal(published[0].channel, 'work:planning:decomposed');
    assert.deepEqual(published[0].data.tasks.tasks, []);
  });

  it('handleDesignComplete spawns swarm when 3+ tasks are decomposed', async () => {
    llm.callLLM = async () => ({
      tasks: [
        { id: 'T1', description: 'Setup', dependencyId: null },
        { id: 'T2', description: 'Build', dependencyId: 'T1' },
        { id: 'T3', description: 'Test', dependencyId: 'T2' },
      ],
    });

    await agent.handleDesignComplete({
      projectId: 'project:swarm-01',
      goal: 'Multi-task project',
      architecture: 'Node.js',
    });

    assert.equal(published.length, 2);
    assert.equal(published[0].channel, 'work:planning:decomposed');
    assert.equal(published[1].channel, 'execution:swarm:spawn');
    assert.equal(published[1].data.swarmId, 'project:swarm-01');
    assert.equal(published[1].data.agentType, 'coder');
    assert.equal(published[1].data.count, 3);
  });

  it('handleDesignComplete caps swarm count at 5', async () => {
    llm.callLLM = async () => ({
      tasks: Array.from({ length: 8 }, (_, i) => ({ id: `T${i}`, description: `Task ${i}`, dependencyId: null })),
    });

    await agent.handleDesignComplete({
      projectId: 'project:big-01',
      goal: 'Large project',
      architecture: 'Node.js',
    });

    const swarmEvent = published.find(p => p.channel === 'execution:swarm:spawn');
    assert.ok(swarmEvent);
    assert.equal(swarmEvent.data.count, 5);
  });

  it('handleDesignComplete does NOT spawn swarm for fewer than 3 tasks', async () => {
    // Default LLM returns 1 task
    await agent.handleDesignComplete({
      projectId: 'project:small-01',
      goal: 'Small project',
      architecture: 'Node.js',
    });

    assert.equal(published.length, 1);
    assert.equal(published[0].channel, 'work:planning:decomposed');
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
