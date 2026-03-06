const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { ResearchAgent } = require('../agent/memory/research-agent');

describe('ResearchAgent', () => {
  let published;
  let statuses;
  let board;
  let agent;

  beforeEach(() => {
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
      publish: async (channel, data) => published.push({ channel, data }),
      updateStatus: async (agentId, status) => statuses.push({ agentId, status }),
    };

    agent = new ResearchAgent({ board });
  });

  it('init sets idle status', async () => {
    await agent.init();
    assert.equal(statuses.at(-1).agentId, 'Kingdom_ResearchAgent');
    assert.equal(statuses.at(-1).status.state, 'idle');
  });

  it('start subscribes to knowledge:research:trigger', async () => {
    let subscribedChannel = null;
    board.createSubscriber = async () => ({
      on: () => {},
      subscribe: async (channel) => { subscribedChannel = channel; },
      disconnect: async () => {},
    });

    await agent.init();
    await agent.start();
    assert.equal(subscribedChannel, 'knowledge:research:trigger');
  });

  it('handleTrigger skips when no question provided', async () => {
    await agent.init();
    const result = await agent.handleTrigger({ author: 'test' });
    assert.equal(result, null);
    assert.equal(published.length, 0);
  });

  it('handleTrigger completes with no MCP clients (graceful)', async () => {
    await agent.init();

    const result = await agent.handleTrigger({
      question: 'What is the best practice for Redis pub/sub?',
      projectId: 'p1',
      author: 'test',
    });

    assert.equal(result.question, 'What is the best practice for Redis pub/sub?');
    assert.equal(result.grokAnswer, null);
    assert.equal(result.nlmAnswer, null);

    // Should still publish completed
    const completed = published.find(p => p.channel === 'knowledge:research:completed');
    assert.ok(completed, 'should publish research:completed');
    assert.equal(completed.data.hasGrokAnswer, false);
    assert.equal(completed.data.hasNlmAnswer, false);
    assert.equal(agent.researchCount, 1);
  });

  it('handleTrigger queries Grok and queues NLM source', async () => {
    const grokClient = {
      askQuestion: async (q) => `Grok answer for: ${q}`,
    };

    agent = new ResearchAgent({ board, grokClient });
    await agent.init();

    const result = await agent.handleTrigger({
      question: 'How does event sourcing work?',
      projectId: 'p2',
      author: 'teamlead',
    });

    assert.ok(result.grokAnswer.includes('Grok answer'));
    assert.equal(result.nlmAnswer, null); // no NLM client

    // Should queue Grok answer for NLM ingestion
    const queued = published.find(p => p.channel === 'knowledge:notebooklm:queued');
    assert.ok(queued, 'should queue for NLM');
    assert.equal(queued.data.queueType, 'research-source');
    assert.ok(queued.data.sourceTitle.includes('event sourcing'));
  });

  it('handleTrigger queries NotebookLM after Grok', async () => {
    const grokClient = {
      askQuestion: async () => 'Grok web search result',
    };
    const nlmClient = {
      askQuestion: async () => 'Refined NLM answer based on stored context',
    };

    agent = new ResearchAgent({ board, grokClient, nlmClient });
    await agent.init();

    const result = await agent.handleTrigger({
      question: 'Redis cluster best practices',
      projectId: 'p3',
      author: 'teamlead',
    });

    assert.equal(result.grokAnswer, 'Grok web search result');
    assert.equal(result.nlmAnswer, 'Refined NLM answer based on stored context');

    const completed = published.find(p => p.channel === 'knowledge:research:completed');
    assert.equal(completed.data.hasGrokAnswer, true);
    assert.equal(completed.data.hasNlmAnswer, true);
  });

  it('handleTrigger pipeline order: Grok → NLM queue → NLM query', async () => {
    const callOrder = [];

    const grokClient = {
      askQuestion: async () => { callOrder.push('grok'); return 'grok result'; },
    };
    const nlmClient = {
      askQuestion: async () => { callOrder.push('nlm-query'); return 'nlm result'; },
    };

    // Track publish for NLM queue
    const origPublish = board.publish;
    board.publish = async (channel, data) => {
      if (channel === 'knowledge:notebooklm:queued') callOrder.push('nlm-queue');
      return origPublish(channel, data);
    };

    agent = new ResearchAgent({ board, grokClient, nlmClient });
    await agent.init();

    await agent.handleTrigger({
      question: 'Test order',
      projectId: 'p4',
      author: 'test',
    });

    assert.deepEqual(callOrder, ['grok', 'nlm-queue', 'nlm-query']);
  });

  it('handleTrigger handles Grok failure gracefully', async () => {
    const grokClient = {
      askQuestion: async () => { throw new Error('Grok is down'); },
    };

    agent = new ResearchAgent({ board, grokClient });
    await agent.init();

    const result = await agent.handleTrigger({
      question: 'Test resilience',
      projectId: 'p5',
      author: 'test',
    });

    assert.equal(result.grokAnswer, null);
    // Should still complete
    const completed = published.find(p => p.channel === 'knowledge:research:completed');
    assert.ok(completed);
  });

  it('handleTrigger handles NLM failure gracefully', async () => {
    const nlmClient = {
      askQuestion: async () => { throw new Error('NLM timeout'); },
    };

    agent = new ResearchAgent({ board, nlmClient });
    await agent.init();

    const result = await agent.handleTrigger({
      question: 'Test NLM failure',
      projectId: 'p6',
      author: 'test',
    });

    assert.equal(result.nlmAnswer, null);
    const completed = published.find(p => p.channel === 'knowledge:research:completed');
    assert.ok(completed);
  });

  it('getStats returns correct state', async () => {
    const grokClient = { askQuestion: async () => '' };
    agent = new ResearchAgent({ board, grokClient });
    await agent.init();

    const stats = agent.getStats();
    assert.equal(stats.researchCount, 0);
    assert.equal(stats.hasGrokClient, true);
    assert.equal(stats.hasNlmClient, false);
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
