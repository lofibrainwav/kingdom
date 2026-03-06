/**
 * Kingdom Research Agent — Phase 5.2
 * Automates the Research Pipeline: Grok → NLM source save → NLM question.
 *
 * Workflow:
 *   1. Receive knowledge:research:trigger
 *   2. Query Grok MCP for web search results
 *   3. Save results as NotebookLM source (via notebooklm-queue pipeline)
 *   4. Query NotebookLM MCP for refined answer
 *   5. Publish knowledge:research:completed
 *
 * Graceful degradation:
 * - Grok MCP unavailable → skip step 1, use question as-is
 * - NotebookLM MCP unavailable → skip step 4, return Grok answer only
 * - Both unavailable → log and skip entirely
 */
const { Blackboard } = require('../core/blackboard');
const { getLogger } = require('../core/logger');

const log = getLogger();

class ResearchAgent {
  constructor(options = {}) {
    this.board = options.board || new Blackboard();
    this.agentId = 'Kingdom_ResearchAgent';
    this.subscriber = null;
    this.researchCount = 0;

    // MCP client stubs — replaced with real implementations when available
    this.grokClient = options.grokClient || null;
    this.nlmClient = options.nlmClient || null;
  }

  async init() {
    await this.board.connect();
    log.info(this.agentId, 'initialized');
    await this.updateStatus('idle', 'Awaiting research triggers');
  }

  async start() {
    this.subscriber = await this.board.createSubscriber();
    this.subscriber.on('error', (err) =>
      log.error(this.agentId, 'Redis sub error', { error: err.message })
    );

    await this.subscriber.subscribe('knowledge:research:trigger', async (msg) => {
      try {
        await this.handleTrigger(msg);
      } catch (err) {
        log.error(this.agentId, 'handleTrigger error', { error: err.message });
      }
    });

    log.info(this.agentId, 'subscribed to knowledge:research:trigger');
  }

  async handleTrigger(message) {
    const data = typeof message === 'string' ? JSON.parse(message) : (message || {});
    const { question, projectId } = data;

    if (!question) {
      log.warn(this.agentId, 'skipping trigger — no question provided');
      return null;
    }

    await this.updateStatus('researching', `Research: ${question.slice(0, 50)}...`);
    log.info(this.agentId, `starting research: ${question.slice(0, 80)}`);

    const result = {
      question,
      projectId,
      grokAnswer: null,
      nlmAnswer: null,
      timestamp: Date.now(),
    };

    // Step 1: Query Grok for web search
    if (this.grokClient) {
      try {
        result.grokAnswer = await this.grokClient.askQuestion(question);
        log.info(this.agentId, 'Grok response received');
      } catch (err) {
        log.warn(this.agentId, `Grok query failed: ${err.message}`);
      }
    } else {
      log.info(this.agentId, 'Grok client not available — skipping web search');
    }

    // Step 2: Save Grok results as NLM source (via notebooklm-queue pipeline)
    if (result.grokAnswer) {
      try {
        await this.board.publish('knowledge:notebooklm:queued', {
          author: this.agentId,
          projectId: projectId || 'research',
          taskId: `research-${Date.now()}`,
          sourcePath: '',
          sourceTitle: `Research: ${question.slice(0, 60)}`,
          queueType: 'research-source',
          content: result.grokAnswer,
        });
        log.info(this.agentId, 'Grok answer queued for NLM ingestion');
      } catch (err) {
        log.warn(this.agentId, `NLM queue publish failed: ${err.message}`);
      }
    }

    // Step 3: Query NotebookLM for refined answer
    if (this.nlmClient) {
      try {
        result.nlmAnswer = await this.nlmClient.askQuestion(question);
        log.info(this.agentId, 'NotebookLM response received');
      } catch (err) {
        log.warn(this.agentId, `NotebookLM query failed: ${err.message}`);
      }
    } else {
      log.info(this.agentId, 'NLM client not available — skipping refined query');
    }

    // Step 4: Publish completed
    this.researchCount++;

    await this.board.publish('knowledge:research:completed', {
      author: this.agentId,
      projectId: projectId || 'research',
      question,
      hasGrokAnswer: !!result.grokAnswer,
      hasNlmAnswer: !!result.nlmAnswer,
      researchId: `research-${result.timestamp}`,
    });

    log.info(this.agentId, `research complete (#${this.researchCount}): grok=${!!result.grokAnswer} nlm=${!!result.nlmAnswer}`);
    await this.updateStatus('idle', `Last research: ${question.slice(0, 40)}...`);

    return result;
  }

  async updateStatus(state, details) {
    await this.board.updateStatus(this.agentId, {
      state,
      task: details,
      health: 20,
      lastUpdate: Date.now(),
    });
  }

  getStats() {
    return {
      researchCount: this.researchCount,
      hasGrokClient: !!this.grokClient,
      hasNlmClient: !!this.nlmClient,
    };
  }

  async shutdown() {
    if (this.subscriber) await this.subscriber.disconnect();
    await this.board.disconnect();
    log.info(this.agentId, 'shutdown complete');
  }
}

module.exports = { ResearchAgent };
