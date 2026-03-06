const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { ReviewerAgent } = require('../agent/team/reviewer');

describe('ReviewerAgent', () => {
  let configs;
  let published;
  let statuses;
  let board;
  let llm;
  let rumination;
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
      callLLM: async () => ({ approved: true, feedback: 'Looks good', suggestedFix: null }),
    };

    rumination = {
      init: async () => {},
    };

    agent = new ReviewerAgent();
    agent.board = board;
    agent.llm = llm;
    agent.rumination = rumination;
  });

  it('init subscribes to governance:review:requested and sets idle status', async () => {
    let subscribedChannel = null;
    board.createSubscriber = async () => ({
      on: () => {},
      subscribe: async (channel) => { subscribedChannel = channel; },
      disconnect: async () => {},
    });

    await agent.init();

    assert.equal(subscribedChannel, 'governance:review:requested');
    assert.equal(statuses.at(-1).agentId, 'Kingdom_Reviewer');
    assert.equal(statuses.at(-1).status.state, 'idle');
  });

  it('handleTaskComplete approves good code and publishes approved event', async () => {
    llm.callLLM = async () => ({
      approved: true,
      feedback: 'Clean implementation',
      suggestedFix: null,
    });

    await agent.handleTaskComplete({
      projectId: 'project:api-01',
      taskId: 'T3',
      file: 'router.js',
      content: 'const router = express.Router();',
    });

    // Saves review
    const review = configs.get('project:api-01:review:T3');
    assert.equal(review.review.approved, true);

    // Publishes approved
    assert.equal(published.length, 1);
    assert.equal(published[0].channel, 'governance:review:approved');
    assert.equal(published[0].data.projectId, 'project:api-01');
    assert.equal(published[0].data.taskId, 'T3');

    // Status: reviewing -> idle
    assert.equal(statuses[0].status.state, 'reviewing');
    assert.equal(statuses.at(-1).status.state, 'idle');
  });

  it('handleTaskComplete rejects bad code and publishes rejected event', async () => {
    llm.callLLM = async () => ({
      approved: false,
      feedback: 'SQL injection vulnerability',
      suggestedFix: 'Use parameterized queries',
    });

    await agent.handleTaskComplete({
      projectId: 'project:db-01',
      taskId: 'T7',
      file: 'query.js',
      content: 'db.query(`SELECT * FROM users WHERE id=${id}`)',
    });

    // Saves review
    const review = configs.get('project:db-01:review:T7');
    assert.equal(review.review.approved, false);

    // Publishes rejected with feedback
    assert.equal(published.length, 1);
    assert.equal(published[0].channel, 'governance:review:rejected');
    assert.equal(published[0].data.feedback, 'SQL injection vulnerability');
    assert.equal(published[0].data.taskId, 'T7');
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
