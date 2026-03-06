const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { TeamLeadAgent } = require('../agent/team/team-lead');

describe('TeamLeadAgent', () => {
  let published;
  let statuses;
  let configs;
  let board;
  let mockAnthropicResponse;
  let apiClients;
  let agent;

  beforeEach(() => {
    published = [];
    statuses = [];
    configs = new Map();

    board = {
      connect: async () => {},
      disconnect: async () => {},
      createSubscriber: async () => ({
        on: () => {},
        subscribe: async () => {},
        disconnect: async () => {},
      }),
      getConfig: async (key) => configs.get(key) || null,
      setConfig: async (key, value) => configs.set(key, value),
      publish: async (channel, data) => published.push({ channel, data }),
      updateStatus: async (agentId, status) => statuses.push({ agentId, status }),
    };

    mockAnthropicResponse = JSON.stringify({
      truth: { score: 4, issues: [] },
      goodness: { score: 5, issues: [] },
      beauty: { score: 3, issues: ['Inconsistent naming'] },
      intersections: {
        truth_goodness: { score: 4, gaps: [] },
        goodness_beauty: { score: 3, gaps: ['Naming vs quality'] },
        truth_beauty: { score: 3, gaps: [] },
      },
      verdict: 'pass',
      summary: 'Solid batch with minor naming issues',
      storeWorthy: true,
    });

    apiClients = {
      anthropic: {
        call: async () => mockAnthropicResponse,
      },
    };

    agent = new TeamLeadAgent({ board, apiClients, batchSize: 3 });
  });

  it('init sets enabled=true when Anthropic client is available', async () => {
    await agent.init();
    assert.equal(agent.enabled, true);
    assert.equal(statuses.at(-1).agentId, 'Kingdom_TeamLead');
    assert.equal(statuses.at(-1).status.state, 'idle');
  });

  it('init sets enabled=false when Anthropic client is missing', async () => {
    agent = new TeamLeadAgent({ board, apiClients: {}, batchSize: 3 });
    await agent.init();
    assert.equal(agent.enabled, false);
  });

  it('init respects Redis config:teamlead settings', async () => {
    configs.set('config:teamlead', { batchSize: 5, model: 'claude-haiku-4-5-20251001' });
    agent = new TeamLeadAgent({ board, apiClients, batchSize: 3 });
    await agent.init();
    assert.equal(agent.batchSize, 5);
    assert.equal(agent.model, 'claude-haiku-4-5-20251001');
  });

  it('init respects config:teamlead enabled=false', async () => {
    configs.set('config:teamlead', { enabled: false });
    agent = new TeamLeadAgent({ board, apiClients, batchSize: 3 });
    await agent.init();
    assert.equal(agent.enabled, false);
  });

  it('handleApproval buffers until batchSize reached', async () => {
    await agent.init();

    await agent.handleApproval({ projectId: 'p1', taskId: 'T1', file: 'a.js', author: 'reviewer' });
    assert.equal(agent.approvalBuffer.length, 1);
    assert.equal(published.length, 0); // no review yet

    await agent.handleApproval({ projectId: 'p1', taskId: 'T2', file: 'b.js', author: 'reviewer' });
    assert.equal(agent.approvalBuffer.length, 2);
    assert.equal(published.length, 0); // still no review
  });

  it('handleApproval triggers batchReview at batchSize', async () => {
    await agent.init();

    await agent.handleApproval({ projectId: 'p1', taskId: 'T1', file: 'a.js', author: 'reviewer' });
    await agent.handleApproval({ projectId: 'p1', taskId: 'T2', file: 'b.js', author: 'reviewer' });
    await agent.handleApproval({ projectId: 'p1', taskId: 'T3', file: 'c.js', author: 'reviewer' });

    // Buffer should be drained
    assert.equal(agent.approvalBuffer.length, 0);

    // Should publish governance:teamlead:reviewed
    const reviewed = published.find(p => p.channel === 'governance:teamlead:reviewed');
    assert.ok(reviewed, 'should publish teamlead:reviewed');
    assert.equal(reviewed.data.verdict, 'pass');
    assert.equal(reviewed.data.batchSize, 3);
    assert.deepEqual(reviewed.data.taskIds, ['T1', 'T2', 'T3']);
  });

  it('batchReview publishes Spider Web scores (진선미)', async () => {
    await agent.init();

    const batch = [
      { projectId: 'p1', taskId: 'T1', file: 'a.js' },
      { projectId: 'p1', taskId: 'T2', file: 'b.js' },
      { projectId: 'p1', taskId: 'T3', file: 'c.js' },
    ];

    const result = await agent.batchReview(batch);

    assert.equal(result.truth.score, 4);
    assert.equal(result.goodness.score, 5);
    assert.equal(result.beauty.score, 3);
    assert.equal(result.verdict, 'pass');
  });

  it('batchReview triggers research pipeline when storeWorthy', async () => {
    await agent.init();

    const batch = [
      { projectId: 'p1', taskId: 'T1', file: 'a.js' },
    ];

    await agent.batchReview(batch);

    const trigger = published.find(p => p.channel === 'knowledge:research:trigger');
    assert.ok(trigger, 'should trigger research pipeline');
    assert.equal(trigger.data.author, 'Kingdom_TeamLead');
    assert.ok(trigger.data.question.includes('T1'));
  });

  it('batchReview does NOT trigger research when verdict=fail', async () => {
    mockAnthropicResponse = JSON.stringify({
      truth: { score: 1, issues: ['Critical bug'] },
      goodness: { score: 2, issues: [] },
      beauty: { score: 1, issues: [] },
      intersections: {
        truth_goodness: { score: 1, gaps: [] },
        goodness_beauty: { score: 1, gaps: [] },
        truth_beauty: { score: 1, gaps: [] },
      },
      verdict: 'fail',
      summary: 'Critical issues found',
      storeWorthy: true,
    });

    await agent.init();
    await agent.batchReview([{ projectId: 'p1', taskId: 'T1', file: 'a.js' }]);

    const trigger = published.find(p => p.channel === 'knowledge:research:trigger');
    assert.equal(trigger, undefined, 'should NOT trigger research on fail');
  });

  it('batchReview skips when disabled (no API key)', async () => {
    agent = new TeamLeadAgent({ board, apiClients: {}, batchSize: 3 });
    await agent.init();

    const result = await agent.batchReview([{ projectId: 'p1', taskId: 'T1', file: 'a.js' }]);
    assert.equal(result, null);
    assert.equal(published.length, 0);
  });

  it('batchReview handles API error gracefully', async () => {
    apiClients.anthropic.call = async () => { throw new Error('API timeout'); };
    await agent.init();

    const result = await agent.batchReview([{ projectId: 'p1', taskId: 'T1', file: 'a.js' }]);
    assert.equal(result, null);
    assert.equal(statuses.at(-1).status.state, 'idle');
    assert.ok(statuses.at(-1).status.task.includes('error'));
  });

  it('batchReview handles unparseable response', async () => {
    apiClients.anthropic.call = async () => 'This is not JSON at all';
    await agent.init();

    const result = await agent.batchReview([{ projectId: 'p1', taskId: 'T1', file: 'a.js' }]);
    assert.equal(result.verdict, 'unknown');
  });

  it('batchReview increments reviewCount', async () => {
    await agent.init();
    assert.equal(agent.reviewCount, 0);

    await agent.batchReview([{ projectId: 'p1', taskId: 'T1', file: 'a.js' }]);
    assert.equal(agent.reviewCount, 1);

    await agent.batchReview([{ projectId: 'p1', taskId: 'T2', file: 'b.js' }]);
    assert.equal(agent.reviewCount, 2);
  });

  it('getStats returns current state', async () => {
    await agent.init();
    const stats = agent.getStats();
    assert.equal(stats.enabled, true);
    assert.equal(stats.reviewCount, 0);
    assert.equal(stats.bufferSize, 0);
    assert.equal(stats.batchSize, 3);
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

  it('start subscribes to governance:review:approved', async () => {
    let subscribedChannel = null;
    board.createSubscriber = async () => ({
      on: () => {},
      subscribe: async (channel) => { subscribedChannel = channel; },
      disconnect: async () => {},
    });

    await agent.init();
    await agent.start();
    assert.equal(subscribedChannel, 'governance:review:approved');
  });
});
