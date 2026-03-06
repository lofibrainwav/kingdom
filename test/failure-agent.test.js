const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { FailureAgent } = require('../agent/team/failure-agent');

describe('FailureAgent', () => {
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
      callLLM: async () => ({
        category: 'Task Failure',
        reason: 'Logic error in auth check',
        mustNotGuardrail: 'no-hardcoded-passwords',
      }),
    };

    agent = new FailureAgent();
    agent.board = board;
    agent.llm = llm;
  });

  it('init subscribes to governance:review:rejected and sets idle status', async () => {
    let subscribedChannel = null;
    board.createSubscriber = async () => ({
      on: () => {},
      subscribe: async (channel) => { subscribedChannel = channel; },
      disconnect: async () => {},
    });

    await agent.init();

    assert.equal(subscribedChannel, 'governance:review:rejected');
    assert.equal(statuses.at(-1).agentId, 'Kingdom_Failure');
    assert.equal(statuses.at(-1).status.state, 'idle');
  });

  it('handleTaskRejection classifies failure and requests retry', async () => {
    llm.callLLM = async (prompt, priority) => {
      assert.equal(priority, 'critical');
      assert.ok(prompt.includes('auth.js'));
      return {
        category: 'Skill Failure',
        reason: 'Missing JWT knowledge',
        mustNotGuardrail: 'no-plaintext-tokens',
      };
    };

    await agent.handleTaskRejection({
      projectId: 'project:auth-01',
      taskId: 'T5',
      file: 'auth.js',
      feedback: 'JWT validation is incorrect and insecure',
    });

    // Saves classification
    const classification = configs.get('project:auth-01:failure:T5');
    assert.equal(classification.classification.category, 'Skill Failure');
    assert.ok(classification.classifiedAt > 0);

    // Publishes retry request
    assert.equal(published.length, 1);
    assert.equal(published[0].channel, 'governance:failure:retry-requested');
    assert.equal(published[0].data.projectId, 'project:auth-01');
    assert.equal(published[0].data.taskId, 'T5');
    assert.equal(published[0].data.category, 'Skill Failure');
    assert.equal(published[0].data.guardrail, 'no-plaintext-tokens');

    // Status: classifying -> idle
    assert.equal(statuses[0].status.state, 'classifying');
    assert.equal(statuses.at(-1).status.state, 'idle');
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
