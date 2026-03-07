const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { TeamLeadAgent, PIPELINE_STAGES } = require('../agent/team/team-lead');

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
    hashFields = [];

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
      setHashField: async (key, field, data) => hashFields.push({ key, field, data }),
      getAllStatuses: async () => ({
        Kingdom_PM: { state: 'idle', lastUpdate: Date.now() },
        Kingdom_Coder: { state: 'coding', lastUpdate: Date.now() },
      }),
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

    agent = new TeamLeadAgent({ board, apiClients, batchSize: 3, healthIntervalMs: 999999 });
  });

  afterEach(async () => {
    if (agent.healthTimer) clearInterval(agent.healthTimer);
  });

  // ── Init / Config ──────────────────────────────────────────────

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

  // ── Approval Buffering ─────────────────────────────────────────

  it('handleApproval buffers until batchSize reached', async () => {
    await agent.init();

    await agent.handleApproval({ projectId: 'p1', taskId: 'T1', file: 'a.js', author: 'reviewer' });
    assert.equal(agent.approvalBuffer.length, 1);
    assert.equal(published.length, 0);

    await agent.handleApproval({ projectId: 'p1', taskId: 'T2', file: 'b.js', author: 'reviewer' });
    assert.equal(agent.approvalBuffer.length, 2);
    assert.equal(published.length, 0);
  });

  it('handleApproval triggers batchReview at batchSize', async () => {
    await agent.init();

    await agent.handleApproval({ projectId: 'p1', taskId: 'T1', file: 'a.js', author: 'reviewer' });
    await agent.handleApproval({ projectId: 'p1', taskId: 'T2', file: 'b.js', author: 'reviewer' });
    await agent.handleApproval({ projectId: 'p1', taskId: 'T3', file: 'c.js', author: 'reviewer' });

    assert.equal(agent.approvalBuffer.length, 0);

    const reviewed = published.find(p => p.channel === 'governance:teamlead:reviewed');
    assert.ok(reviewed, 'should publish teamlead:reviewed');
    assert.equal(reviewed.data.verdict, 'pass');
    assert.equal(reviewed.data.batchSize, 3);
    assert.deepEqual(reviewed.data.taskIds, ['T1', 'T2', 'T3']);
  });

  // ── Spider Web (진선미) ────────────────────────────────────────

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

  // ── EROS V6 Integration ──────────────────────────────────────────

  it('batchReview includes EROS V6 scores in reviewed event', async () => {
    await agent.init();
    await agent.batchReview([{ projectId: 'p1', taskId: 'T1', file: 'a.js' }]);

    const reviewed = published.find(p => p.channel === 'governance:teamlead:reviewed');
    assert.ok(reviewed.data.eros, 'should include eros field');
    assert.equal(typeof reviewed.data.eros.sScore, 'number');
    assert.equal(typeof reviewed.data.eros.fScore, 'number');
    assert.ok(['AUTO_RUN', 'ASK_COMMANDER', 'BLOCK'].includes(reviewed.data.eros.decision));
    assert.ok(reviewed.data.eros.pillars, 'should include 6-pillar breakdown');
    assert.equal(typeof reviewed.data.eros.pillars.benevolence, 'number');
  });

  it('batchReview accumulates EROS history in Redis', async () => {
    await agent.init();
    await agent.batchReview([{ projectId: 'p1', taskId: 'T1', file: 'a.js' }]);

    const erosEntry = hashFields.find(h => h.key === 'eros:reviews');
    assert.ok(erosEntry, 'should store EROS review in Redis');
    assert.equal(typeof erosEntry.data.sScore, 'number');
    assert.equal(erosEntry.data.projectId, 'p1');
    assert.ok(erosEntry.field.startsWith('review-'));
  });

  it('EROS maps mock Spider Web (T:4, G:5, B:3) to correct pillars', async () => {
    await agent.init();
    await agent.batchReview([{ projectId: 'p1', taskId: 'T1', file: 'a.js' }]);

    const reviewed = published.find(p => p.channel === 'governance:teamlead:reviewed');
    const p = reviewed.data.eros.pillars;
    // truth=4*2=8, goodness=5*2=10, beauty=3*2=6
    assert.equal(p.truth, 8);
    assert.equal(p.goodness, 10);
    assert.equal(p.beauty, 6);
    // benevolence=(4+5)/2*2=9, loyalty=(4+3)/2*2=7, eternity=(4+5+3)/3*2=8
    assert.equal(p.benevolence, 9);
    assert.equal(p.loyalty, 7);
    assert.equal(p.eternity, 8);
  });

  it('batchReview triggers research pipeline when storeWorthy', async () => {
    await agent.init();
    await agent.batchReview([{ projectId: 'p1', taskId: 'T1', file: 'a.js' }]);

    const trigger = published.find(p => p.channel === 'knowledge:research:trigger');
    assert.ok(trigger, 'should trigger research pipeline');
    assert.equal(trigger.data.author, 'Kingdom_TeamLead');
  });

  it('quality gate: fail verdict rejects all tasks back for rework', async () => {
    mockAnthropicResponse = JSON.stringify({
      truth: { score: 1, issues: ['Critical logic error'] },
      goodness: { score: 2, issues: ['Security hole'] },
      beauty: { score: 1, issues: ['Unreadable'] },
      intersections: {
        truth_goodness: { score: 1, gaps: [] },
        goodness_beauty: { score: 1, gaps: [] },
        truth_beauty: { score: 1, gaps: [] },
      },
      verdict: 'fail',
      summary: 'Critical issues in all axes',
      storeWorthy: false,
    });

    await agent.init();
    const batch = [
      { projectId: 'p1', taskId: 'T1', file: 'a.js' },
      { projectId: 'p1', taskId: 'T2', file: 'b.js' },
    ];
    await agent.batchReview(batch);

    // Should reject EACH task
    const rejections = published.filter(p => p.channel === 'governance:review:rejected');
    assert.equal(rejections.length, 2);
    assert.equal(rejections[0].data.taskId, 'T1');
    assert.equal(rejections[1].data.taskId, 'T2');
    assert.ok(rejections[0].data.feedback.includes('Spider Web FAIL'));
    assert.equal(rejections[0].data.author, 'Kingdom_TeamLead');
  });

  it('quality gate: partial verdict sends vibe feedback without rejection', async () => {
    mockAnthropicResponse = JSON.stringify({
      truth: { score: 4, issues: [] },
      goodness: { score: 3, issues: ['Minor perf issue'] },
      beauty: { score: 2, issues: ['Messy structure'] },
      intersections: {
        truth_goodness: { score: 3, gaps: ['Performance gap'] },
        goodness_beauty: { score: 2, gaps: ['Structure vs maintainability'] },
        truth_beauty: { score: 3, gaps: [] },
      },
      verdict: 'partial',
      summary: 'Truth ok, but beauty needs work',
      storeWorthy: false,
    });

    await agent.init();
    await agent.batchReview([{ projectId: 'p1', taskId: 'T1', file: 'a.js' }]);

    // Should NOT hard-reject
    const rejections = published.filter(p => p.channel === 'governance:review:rejected');
    assert.equal(rejections.length, 0);

    // Should publish vibe-translated with gaps
    const vibe = published.find(p => p.channel === 'governance:teamlead:vibe-translated');
    assert.ok(vibe);
    assert.ok(vibe.data.metaInsight.includes('Partial pass'));
    assert.ok(vibe.data.patterns[0].gap.includes('Performance gap'));
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
  });

  it('batchReview handles API error gracefully', async () => {
    apiClients.anthropic.call = async () => { throw new Error('API timeout'); };
    await agent.init();

    const result = await agent.batchReview([{ projectId: 'p1', taskId: 'T1', file: 'a.js' }]);
    assert.equal(result, null);
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

  // ── Pipeline Flow Tracking ─────────────────────────────────────

  it('tracks pipeline events per project', async () => {
    await agent.init();

    agent._trackPipelineEvent('work:intake', { projectId: 'p1', author: 'pm' });
    agent._trackPipelineEvent('work:planning:init', { projectId: 'p1', author: 'pm' });
    agent._trackPipelineEvent('work:intake', { projectId: 'p2', author: 'pm' });

    const p1 = agent.getPipelineState('p1');
    assert.ok(p1);
    assert.equal(p1.stages['work:intake'].count, 1);
    assert.equal(p1.stages['work:planning:init'].count, 1);

    const p2 = agent.getPipelineState('p2');
    assert.equal(p2.stages['work:intake'].count, 1);
  });

  it('tracks cumulative counts per stage', async () => {
    await agent.init();

    agent._trackPipelineEvent('governance:review:requested', { projectId: 'p1', author: 'coder' });
    agent._trackPipelineEvent('governance:review:requested', { projectId: 'p1', author: 'coder' });
    agent._trackPipelineEvent('governance:review:requested', { projectId: 'p1', author: 'coder' });

    const flow = agent.getPipelineState('p1');
    assert.equal(flow.stages['governance:review:requested'].count, 3);
  });

  it('getPipelineState returns all projects when no id given', async () => {
    await agent.init();

    agent._trackPipelineEvent('work:intake', { projectId: 'p1', author: 'pm' });
    agent._trackPipelineEvent('work:intake', { projectId: 'p2', author: 'pm' });

    const all = agent.getPipelineState();
    assert.equal(typeof all.p1, 'object', 'should contain p1 pipeline state');
    assert.equal(typeof all.p2, 'object', 'should contain p2 pipeline state');
  });

  it('getPipelineState returns null for unknown project', async () => {
    await agent.init();
    assert.equal(agent.getPipelineState('nonexistent'), null);
  });

  // ── Pipeline Health Report ─────────────────────────────────────

  it('health report saves to Redis config', async () => {
    await agent.init();

    agent._trackPipelineEvent('work:intake', { projectId: 'p1', author: 'pm' });
    await agent._reportPipelineHealth();

    const health = configs.get('teamlead:health');
    assert.ok(health);
    assert.equal(health.agentCount, 2); // mock returns 2 statuses
    assert.equal(health.activeAgents, 1); // Kingdom_Coder is 'coding'
    assert.equal(health.trackedProjects, 1);
  });

  it('health report detects review bottleneck', async () => {
    await agent.init();

    // 5 review requests, only 1 approved, 0 rejected → 4 pending
    for (let i = 0; i < 5; i++) {
      agent._trackPipelineEvent('governance:review:requested', { projectId: 'p1', author: 'coder' });
    }
    agent._trackPipelineEvent('governance:review:approved', { projectId: 'p1', author: 'reviewer' });

    await agent._reportPipelineHealth();

    const health = configs.get('teamlead:health');
    assert.equal(health.bottlenecks.length, 1);
    assert.equal(health.bottlenecks[0].stage, 'review');
    assert.equal(health.bottlenecks[0].pending, 4);
  });

  it('health report detects retry loop', async () => {
    await agent.init();

    for (let i = 0; i < 4; i++) {
      agent._trackPipelineEvent('governance:failure:retry-requested', { projectId: 'p1', author: 'failure' });
    }

    await agent._reportPipelineHealth();

    const health = configs.get('teamlead:health');
    const retryBottleneck = health.bottlenecks.find(b => b.stage === 'retry-loop');
    assert.ok(retryBottleneck);
    assert.equal(retryBottleneck.retries, 4);
  });

  // ── Failure Buffering + Vibe Translation ───────────────────────

  it('buffers failures and auto-triggers vibeTranslate at batchSize', async () => {
    const vibeResponse = JSON.stringify({
      patterns: [{ intent: 'clean code', gap: 'naming inconsistency', guardrail: 'use camelCase' }],
      metaInsight: 'Naming conventions are the core issue',
      suggestedPromptPatch: 'Always use camelCase for variables',
    });
    apiClients.anthropic.call = async () => vibeResponse;

    await agent.init();

    // Buffer 3 failures (= batchSize)
    agent._bufferFailure({ projectId: 'p1', taskId: 'T1', file: 'a.js', feedback: 'bad naming', author: 'reviewer' });
    agent._bufferFailure({ projectId: 'p1', taskId: 'T2', file: 'b.js', feedback: 'inconsistent', author: 'reviewer' });
    // Third triggers vibeTranslate
    agent._bufferFailure({ projectId: 'p1', taskId: 'T3', file: 'c.js', feedback: 'wrong case', author: 'reviewer' });

    assert.equal(agent.failureBuffer.length, 0); // drained

    // Wait for async vibeTranslate to complete
    await new Promise(resolve => setTimeout(resolve, 50));

    const vibe = published.find(p => p.channel === 'governance:teamlead:vibe-translated');
    assert.ok(vibe, 'should publish vibe-translated');
    assert.equal(vibe.data.failureCount, 3);
    assert.ok(vibe.data.metaInsight.includes('Naming'));
  });

  it('vibeTranslate skips when disabled', async () => {
    agent = new TeamLeadAgent({ board, apiClients: {}, batchSize: 3 });
    await agent.init();

    const result = await agent.vibeTranslate([{ taskId: 'T1', feedback: 'test' }]);
    assert.equal(result, null);
  });

  it('vibeTranslate handles API error gracefully', async () => {
    apiClients.anthropic.call = async () => { throw new Error('vibe API down'); };
    await agent.init();

    const result = await agent.vibeTranslate([{ taskId: 'T1', feedback: 'test' }]);
    assert.equal(result, null);
    assert.ok(statuses.at(-1).status.task.includes('Vibe error'));
  });

  it('_bufferFailure skips own rejections to prevent infinite loop', async () => {
    agent = new TeamLeadAgent({ board, apiClients, batchSize: 3 });
    await agent.init();

    // Buffer own rejection (author === agentId)
    agent._bufferFailure({ projectId: 'p1', taskId: 'T1', author: agent.agentId });
    assert.equal(agent.failureBuffer.length, 0, 'own rejection should be skipped');

    // Buffer external rejection
    agent._bufferFailure({ projectId: 'p1', taskId: 'T2', author: 'reviewer' });
    assert.equal(agent.failureBuffer.length, 1, 'external rejection should be buffered');
  });

  // ── Stats / Lifecycle ──────────────────────────────────────────

  it('getStats returns extended state', async () => {
    await agent.init();
    agent._trackPipelineEvent('work:intake', { projectId: 'p1', author: 'pm' });

    const stats = agent.getStats();
    assert.equal(stats.enabled, true);
    assert.equal(stats.reviewCount, 0);
    assert.equal(stats.approvalBufferSize, 0);
    assert.equal(stats.failureBufferSize, 0);
    assert.equal(stats.batchSize, 3);
    assert.equal(stats.trackedProjects, 1);
  });

  it('shutdown clears healthTimer, disconnects subscriber and board', async () => {
    let subDisconnected = false;
    let boardDisconnected = false;

    agent.healthTimer = setInterval(() => {}, 99999);
    agent.subscriber = { disconnect: async () => { subDisconnected = true; } };
    board.disconnect = async () => { boardDisconnected = true; };

    await agent.shutdown();
    assert.equal(subDisconnected, true, 'subscriber should be disconnected');
    assert.equal(boardDisconnected, true, 'board should be disconnected');
  });

  it('start subscribes to all pipeline stages + review channels', async () => {
    const subscribedChannels = [];
    board.createSubscriber = async () => ({
      on: () => {},
      subscribe: async (channel) => { subscribedChannels.push(channel); },
      disconnect: async () => {},
    });

    await agent.init();
    await agent.start();

    // Should subscribe to all PIPELINE_STAGES + governance:review:approved + governance:review:rejected
    // Note: governance:review:approved and governance:review:rejected are in PIPELINE_STAGES too,
    // so they get subscribed twice (once for tracking, once for handling).
    // The handler-specific subscriptions add their own callbacks.
    for (const stage of PIPELINE_STAGES) {
      assert.ok(
        subscribedChannels.includes(stage),
        `should subscribe to ${stage}`
      );
    }
    assert.equal(subscribedChannels.length >= PIPELINE_STAGES.length + 2, true,
      `should subscribe to at least ${PIPELINE_STAGES.length + 2} channels, got ${subscribedChannels.length}`);
  });

  it('PIPELINE_STAGES exports the logical pipeline order', () => {
    assert.ok(Array.isArray(PIPELINE_STAGES));
    assert.equal(PIPELINE_STAGES[0], 'work:intake');
    assert.ok(PIPELINE_STAGES.includes('governance:project:approved'));
  });
});
