const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { PMAgent } = require('../agent/team/pm-agent');

describe('PMAgent', () => {
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

    agent = new PMAgent();
    agent.board = board;
    agent.taskRunner.board = board;
  });

  it('creates a new planning flow for standard work intake', async () => {
    await agent.handleManualAssign({
      author: 'codex',
      task: 'Design the knowledge plane',
    });

    assert.equal(configs.size, 1);
    const [[projectId, projectState]] = [...configs.entries()];
    assert.match(projectId, /^project:/);
    assert.equal(projectState.goal, 'Design the knowledge plane');
    assert.equal(projectState.status, 'init');

    assert.equal(published.length, 1);
    assert.equal(published[0].channel, 'work:planning:init');
    assert.equal(published[0].data.projectId, projectId);
    assert.equal(published[0].data.retry, false);
    assert.equal(statuses.at(-1).status.state, 'processing');
  });

  it('treats retry intake as continuation of the existing task', async () => {
    configs.set('tasks:kingdom:TASK-501', {
      projectId: 'kingdom',
      taskId: 'TASK-501',
      goal: 'Recover verification gap',
      status: 'retry_requested',
      retry: {
        category: 'review',
        guardrail: 'missing-evidence',
        handoff: {
          status: 'queued',
          channel: 'work:intake',
        },
      },
      updatedAt: Date.now() - 1000,
    });

    await agent.handleManualAssign({
      author: 'failure-agent',
      task: 'Retry TASK-501: Recover verification gap',
      goal: 'Recover verification gap',
      projectId: 'kingdom',
      taskId: 'TASK-501',
      retry: true,
      retryCategory: 'review',
      retryGuardrail: 'missing-evidence',
    });

    assert.equal(configs.get('kingdom').status, 'retry_intake');
    assert.equal(configs.get('kingdom').retry.taskId, 'TASK-501');

    const taskState = configs.get('tasks:kingdom:TASK-501');
    assert.equal(taskState.status, 'replanning');
    assert.equal(taskState.retry.handoff.status, 'claimed');
    assert.equal(taskState.retry.handoff.claimedBy, 'Octiv_PM');

    assert.equal(published.length, 1);
    assert.equal(published[0].channel, 'work:planning:init');
    assert.equal(published[0].data.projectId, 'kingdom');
    assert.equal(published[0].data.taskId, 'TASK-501');
    assert.equal(published[0].data.retry, true);
    assert.equal(published[0].data.retryGuardrail, 'missing-evidence');
  });
});
