/**
 * Kingdom Team Lead Agent — Phase 5.1
 * Claude as metacognitive supervisor for Ralph Team (local LLM) output.
 *
 * Responsibilities:
 * 1. Batch-review N approved tasks via Claude (high model)
 * 2. Spider Web cross-check: Truth x Goodness x Beauty (진선미)
 * 3. Selective knowledge storage — only "important" results get persisted
 * 4. Trigger Research Pipeline when progress ("차도") is detected
 *
 * Cost control:
 * - ANTHROPIC_API_KEY absent → graceful skip (local-only mode)
 * - Batch reviews (not per-task) → minimal API calls
 * - Configurable batch size via Redis config:teamlead
 */
const { Blackboard } = require('../core/blackboard');
const { getLogger } = require('../core/logger');
const { createApiClients } = require('../core/api-clients');
const log = getLogger();

const SPIDER_WEB_PROMPT = `Evaluate this code batch from 3 axes and their intersections:

## Axes
- Truth (진): correctness, edge cases, logic errors
- Goodness (선): security, performance, maintainability
- Beauty (미): structure, naming, pattern consistency

## Cross-check pairs
1. Truth ∩ Goodness: Correct AND well-built?
2. Goodness ∩ Beauty: Well-built AND elegant?
3. Truth ∩ Beauty: Correct AND clean structure?

Rate each axis 1-5. Identify gaps at each intersection.
Return JSON:
{
  "truth": { "score": <1-5>, "issues": [...] },
  "goodness": { "score": <1-5>, "issues": [...] },
  "beauty": { "score": <1-5>, "issues": [...] },
  "intersections": {
    "truth_goodness": { "score": <1-5>, "gaps": [...] },
    "goodness_beauty": { "score": <1-5>, "gaps": [...] },
    "truth_beauty": { "score": <1-5>, "gaps": [...] }
  },
  "verdict": "pass" | "partial" | "fail",
  "summary": "<one-line summary>",
  "storeWorthy": <boolean — is this worth persisting to long-term knowledge?>
}

Code batch:
`;

const DEFAULT_BATCH_SIZE = 3;
const DEFAULT_MODEL = 'claude-sonnet-4-20250514';

class TeamLeadAgent {
  constructor(options = {}) {
    this.board = options.board || new Blackboard();
    this.agentId = 'Kingdom_TeamLead';
    this.approvalBuffer = [];
    this.batchSize = options.batchSize || DEFAULT_BATCH_SIZE;
    this.model = options.model || DEFAULT_MODEL;
    this.apiClients = options.apiClients || null;
    this.subscriber = null;
    this.enabled = false;
    this.reviewCount = 0;
  }

  async init() {
    await this.board.connect();

    // Load config from Redis (allows runtime tuning)
    const config = await this.board.getConfig('config:teamlead');
    if (config) {
      if (config.batchSize) this.batchSize = config.batchSize;
      if (config.model) this.model = config.model;
      if (config.enabled === false) {
        this.enabled = false;
        log.info(this.agentId, 'disabled via config:teamlead');
        return;
      }
    }

    // Create API clients (graceful if no ANTHROPIC_API_KEY)
    if (!this.apiClients) {
      this.apiClients = createApiClients();
    }
    this.enabled = !!this.apiClients.anthropic;

    if (!this.enabled) {
      log.info(this.agentId, 'initialized (disabled — no Anthropic client)');
    } else {
      log.info(this.agentId, `initialized (model: ${this.model}, batch: ${this.batchSize})`);
    }

    await this.updateStatus('idle', this.enabled ? 'Awaiting approvals' : 'Disabled — no API key');
  }

  async start() {
    this.subscriber = await this.board.createSubscriber();
    this.subscriber.on('error', (err) =>
      log.error(this.agentId, 'Redis sub error', { error: err.message })
    );

    await this.subscriber.subscribe('governance:review:approved', async (msg) => {
      try {
        await this.handleApproval(msg);
      } catch (err) {
        log.error(this.agentId, 'handleApproval error', { error: err.message });
      }
    });

    log.info(this.agentId, 'subscribed to governance:review:approved');
  }

  async handleApproval(message) {
    const data = typeof message === 'string' ? JSON.parse(message) : (message || {});
    this.approvalBuffer.push(data);
    log.info(this.agentId, `buffered approval ${this.approvalBuffer.length}/${this.batchSize}: ${data.taskId}`);

    if (this.approvalBuffer.length >= this.batchSize) {
      const batch = this.approvalBuffer.splice(0, this.batchSize);
      await this.batchReview(batch);
    }
  }

  async batchReview(batch) {
    if (!this.enabled) {
      log.info(this.agentId, `skipping batch review (disabled) — ${batch.length} items`);
      return null;
    }

    await this.updateStatus('reviewing', `Batch review: ${batch.length} items`);

    // Build code summary for Claude
    const codeSummary = batch.map((item, i) =>
      `### [${i + 1}] Task ${item.taskId} (${item.file || 'unknown'})\nProject: ${item.projectId}\n`
    ).join('\n');

    const prompt = SPIDER_WEB_PROMPT + codeSummary;

    try {
      const response = await this.apiClients.anthropic.call(this.model, prompt);
      const result = this._parseResult(response);

      this.reviewCount++;

      // Publish review result
      await this.board.publish('governance:teamlead:reviewed', {
        author: this.agentId,
        batchSize: batch.length,
        taskIds: batch.map(b => b.taskId),
        projectId: batch[0]?.projectId,
        verdict: result.verdict || 'unknown',
        scores: {
          truth: result.truth?.score,
          goodness: result.goodness?.score,
          beauty: result.beauty?.score,
        },
        summary: result.summary || '',
        storeWorthy: result.storeWorthy || false,
      });

      log.info(this.agentId, `batch review complete: ${result.verdict} (T:${result.truth?.score} G:${result.goodness?.score} B:${result.beauty?.score})`);

      // If progress detected and result is store-worthy, trigger research
      if (result.storeWorthy && result.verdict !== 'fail') {
        await this.board.publish('knowledge:research:trigger', {
          author: this.agentId,
          question: `Based on recent approved code batch (${batch.map(b => b.taskId).join(', ')}): ${result.summary}`,
          projectId: batch[0]?.projectId,
        });
        log.info(this.agentId, 'progress detected — triggered research pipeline');
      }

      await this.updateStatus('idle', `Last review: ${result.verdict}`);
      return result;
    } catch (err) {
      log.error(this.agentId, 'batch review failed', { error: err.message });
      await this.updateStatus('idle', `Review error: ${err.message}`);
      return null;
    }
  }

  _parseResult(response) {
    if (typeof response === 'object' && response !== null) return response;
    try {
      const text = String(response).replace(/<think>[\s\S]*?<\/think>/g, '').trim();
      const match = text.match(/\{[\s\S]*\}/);
      if (match) return JSON.parse(match[0]);
    } catch { /* fall through */ }
    return { verdict: 'unknown', summary: 'Failed to parse review response' };
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
      enabled: this.enabled,
      reviewCount: this.reviewCount,
      bufferSize: this.approvalBuffer.length,
      batchSize: this.batchSize,
      model: this.model,
    };
  }

  async shutdown() {
    if (this.subscriber) await this.subscriber.disconnect();
    await this.board.disconnect();
    log.info(this.agentId, 'shutdown complete');
  }
}

module.exports = { TeamLeadAgent };
