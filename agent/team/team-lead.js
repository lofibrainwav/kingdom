/**
 * Kingdom Team Lead Agent — Phase 5 (Director)
 * Claude as Chief Director / Vibe Translator for the entire Ralph Team pipeline.
 *
 * Responsibilities:
 * 1. Pipeline supervision — track all stages, detect bottlenecks
 * 2. Redis management — agent health aggregation, pipeline flow monitoring
 * 3. Batch review — Spider Web cross-check (진선미 Truth x Goodness x Beauty)
 * 4. Vibe translation — translate failure patterns into actionable human-intent
 * 5. Selective storage — only "important" results get persisted to NLM/Vault
 * 6. Research trigger — detect progress ("차도") and kick off Grok→NLM pipeline
 *
 * Cost control:
 * - ANTHROPIC_API_KEY absent → graceful skip (pipeline monitoring still active)
 * - Batch reviews (not per-task) → minimal API calls
 * - Configurable via Redis config:teamlead
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

const VIBE_TRANSLATE_PROMPT = `You are a Vibe Translator. Analyze these failure patterns and translate them into actionable human-intent directives for the next pipeline round.

Failures:
{failures}

For each failure, explain:
1. What the developer INTENDED (the vibe)
2. What went WRONG (the gap between intent and output)
3. A concrete guardrail to prevent recurrence

Return JSON:
{
  "patterns": [
    { "intent": "...", "gap": "...", "guardrail": "..." }
  ],
  "metaInsight": "<one-line pattern across all failures>",
  "suggestedPromptPatch": "<system prompt addition for next round>"
}
`;

// Pipeline stages in logical order
const PIPELINE_STAGES = [
  'work:intake',
  'work:planning:init',
  'work:planning:designed',
  'work:planning:decomposed',
  'governance:review:requested',
  'governance:review:approved',
  'governance:review:rejected',
  'governance:failure:retry-requested',
  'governance:project:approved',
];

const DEFAULT_BATCH_SIZE = 3;
const DEFAULT_MODEL = 'claude-sonnet-4-20250514';
const PIPELINE_HEALTH_INTERVAL_MS = 60000; // 1 min

class TeamLeadAgent {
  constructor(options = {}) {
    this.board = options.board || new Blackboard();
    this.agentId = 'Kingdom_TeamLead';
    this.approvalBuffer = [];
    this.failureBuffer = [];
    this.batchSize = options.batchSize || DEFAULT_BATCH_SIZE;
    this.model = options.model || DEFAULT_MODEL;
    this.apiClients = options.apiClients || null;
    this.subscriber = null;
    this.enabled = false; // Claude API available
    this.reviewCount = 0;
    this.healthTimer = null;
    this.healthIntervalMs = options.healthIntervalMs || PIPELINE_HEALTH_INTERVAL_MS;

    // Pipeline flow tracking (counts per stage per project)
    this.pipelineFlow = {};
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
        await this.updateStatus('idle', 'Disabled via config');
        return;
      }
    }

    // Create API clients (graceful if no ANTHROPIC_API_KEY)
    if (!this.apiClients) {
      this.apiClients = createApiClients();
    }
    this.enabled = !!this.apiClients.anthropic;

    if (!this.enabled) {
      log.info(this.agentId, 'initialized (monitoring only — no Anthropic client)');
    } else {
      log.info(this.agentId, `initialized (director mode, model: ${this.model}, batch: ${this.batchSize})`);
    }

    await this.updateStatus('idle', this.enabled ? 'Director ready' : 'Monitoring only — no API key');
  }

  async start() {
    this.subscriber = await this.board.createSubscriber();
    this.subscriber.on('error', (err) =>
      log.error(this.agentId, 'Redis sub error', { error: err.message })
    );

    // 1. Pipeline flow monitoring — subscribe to ALL pipeline stages
    for (const stage of PIPELINE_STAGES) {
      await this.subscriber.subscribe(stage, async (msg) => {
        try {
          this._trackPipelineEvent(stage, msg);
        } catch (err) {
          log.error(this.agentId, `pipeline tracking error on ${stage}`, { error: err.message });
        }
      });
    }

    // 2. Batch review trigger — approved tasks
    await this.subscriber.subscribe('governance:review:approved', async (msg) => {
      try {
        await this.handleApproval(msg);
      } catch (err) {
        log.error(this.agentId, 'handleApproval error', { error: err.message });
      }
    });

    // 3. Failure pattern collection — for vibe translation
    await this.subscriber.subscribe('governance:review:rejected', async (msg) => {
      try {
        this._bufferFailure(msg);
      } catch (err) {
        log.error(this.agentId, 'failure buffer error', { error: err.message });
      }
    });

    // 4. Periodic pipeline health report
    this.healthTimer = setInterval(() => {
      this._reportPipelineHealth().catch((err) =>
        log.error(this.agentId, 'health report error', { error: err.message })
      );
    }, this.healthIntervalMs);

    log.info(this.agentId, `subscribed to ${PIPELINE_STAGES.length} pipeline stages + review channels`);
  }

  // ── Pipeline Flow Tracking (Redis Management) ──────────────────

  _trackPipelineEvent(stage, message) {
    const data = typeof message === 'string' ? JSON.parse(message) : (message || {});
    const projectId = data.projectId || 'unknown';

    if (!this.pipelineFlow[projectId]) {
      this.pipelineFlow[projectId] = { stages: {}, firstSeen: Date.now(), lastSeen: Date.now() };
    }

    const flow = this.pipelineFlow[projectId];
    flow.lastSeen = Date.now();

    if (!flow.stages[stage]) {
      flow.stages[stage] = { count: 0, firstAt: Date.now(), lastAt: Date.now() };
    }
    flow.stages[stage].count++;
    flow.stages[stage].lastAt = Date.now();
  }

  async _reportPipelineHealth() {
    const agentStatuses = await this.board.getAllStatuses();
    const agentCount = Object.keys(agentStatuses).length;
    const activeAgents = Object.entries(agentStatuses).filter(
      ([, s]) => s.state && s.state !== 'idle'
    ).length;

    // Detect bottlenecks: stages where events pile up without progressing
    const bottlenecks = [];
    for (const [projectId, flow] of Object.entries(this.pipelineFlow)) {
      const stages = flow.stages;
      // If review:requested > review:approved + review:rejected → bottleneck at review
      const requested = stages['governance:review:requested']?.count || 0;
      const approved = stages['governance:review:approved']?.count || 0;
      const rejected = stages['governance:review:rejected']?.count || 0;
      const pending = requested - approved - rejected;
      if (pending > 2) {
        bottlenecks.push({ projectId, stage: 'review', pending });
      }

      // If retries > 3 for same project → stuck in failure loop
      const retries = stages['governance:failure:retry-requested']?.count || 0;
      if (retries > 3) {
        bottlenecks.push({ projectId, stage: 'retry-loop', retries });
      }
    }

    // Save health report to Redis
    await this.board.setConfig('teamlead:health', {
      timestamp: Date.now(),
      agentCount,
      activeAgents,
      trackedProjects: Object.keys(this.pipelineFlow).length,
      bottlenecks,
      pipelineFlow: this.pipelineFlow,
    });

    if (bottlenecks.length > 0) {
      log.warn(this.agentId, `pipeline bottlenecks detected: ${JSON.stringify(bottlenecks)}`);
    }
  }

  // ── Approval Handling + Spider Web Review ──────────────────────

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

      // Quality gate: TeamLead takes responsibility for output quality
      if (result.verdict === 'fail') {
        // Hard reject — send ALL tasks back for rework
        log.warn(this.agentId, `QUALITY GATE: rejecting batch (${batch.length} tasks) — ${result.summary}`);
        for (const item of batch) {
          await this.board.publish('governance:review:rejected', {
            projectId: item.projectId,
            taskId: item.taskId,
            file: item.file || 'unknown',
            feedback: `[TeamLead Spider Web FAIL] ${result.summary}. Truth:${result.truth?.score}/5, Goodness:${result.goodness?.score}/5, Beauty:${result.beauty?.score}/5. Issues: ${this._collectIssues(result)}`,
            author: this.agentId,
          });
        }
      } else if (result.verdict === 'partial') {
        // Partial — identify weak-axis tasks and send specific feedback
        const gaps = this._collectGaps(result);
        log.warn(this.agentId, `QUALITY GATE: partial pass — gaps: ${gaps}`);
        await this.board.publish('governance:teamlead:vibe-translated', {
          author: this.agentId,
          failureCount: 0,
          taskIds: batch.map(b => b.taskId),
          projectId: batch[0]?.projectId,
          patterns: [{ intent: 'quality improvement', gap: gaps, guardrail: result.summary }],
          metaInsight: `Partial pass — strengthen: ${gaps}`,
          suggestedPromptPatch: `Pay extra attention to: ${gaps}`,
        });
      }

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

  // ── Failure Buffering + Vibe Translation ──────────────────────

  _bufferFailure(message) {
    const data = typeof message === 'string' ? JSON.parse(message) : (message || {});

    // Guard: skip own rejections to prevent infinite loop
    if (data.author === this.agentId) {
      log.debug(this.agentId, `skipping own rejection for ${data.taskId}`);
      return;
    }

    this.failureBuffer.push({
      ...data,
      bufferedAt: Date.now(),
    });
    log.info(this.agentId, `buffered failure ${this.failureBuffer.length}/${this.batchSize}: ${data.taskId}`);

    // Auto-trigger vibe translation when enough failures accumulate
    if (this.failureBuffer.length >= this.batchSize) {
      const batch = this.failureBuffer.splice(0, this.batchSize);
      this.vibeTranslate(batch).catch((err) =>
        log.error(this.agentId, 'vibeTranslate error', { error: err.message })
      );
    }
  }

  async vibeTranslate(failureBatch) {
    if (!this.enabled) {
      log.info(this.agentId, `skipping vibe translation (disabled) — ${failureBatch.length} failures`);
      return null;
    }

    await this.updateStatus('translating', `Vibe translating ${failureBatch.length} failures`);

    const failureSummary = failureBatch.map((f, i) =>
      `[${i + 1}] Task ${f.taskId} (${f.file || 'unknown'}): ${f.feedback || 'no feedback'}`
    ).join('\n');

    const prompt = VIBE_TRANSLATE_PROMPT.replace('{failures}', failureSummary);

    try {
      const response = await this.apiClients.anthropic.call(this.model, prompt);
      const result = this._parseResult(response);

      // Publish vibe translation for downstream agents
      await this.board.publish('governance:teamlead:vibe-translated', {
        author: this.agentId,
        failureCount: failureBatch.length,
        taskIds: failureBatch.map(f => f.taskId),
        projectId: failureBatch[0]?.projectId,
        patterns: result.patterns || [],
        metaInsight: result.metaInsight || '',
        suggestedPromptPatch: result.suggestedPromptPatch || '',
      });

      log.info(this.agentId, `vibe translated: ${result.metaInsight || 'no insight'}`);
      await this.updateStatus('idle', `Last vibe: ${(result.metaInsight || '').slice(0, 50)}`);
      return result;
    } catch (err) {
      log.error(this.agentId, 'vibe translation failed', { error: err.message });
      await this.updateStatus('idle', `Vibe error: ${err.message}`);
      return null;
    }
  }

  // ── Pipeline Query (for dashboard / external queries) ─────────

  getPipelineState(projectId) {
    if (projectId) {
      return this.pipelineFlow[projectId] || null;
    }
    return { ...this.pipelineFlow };
  }

  // ── Utilities ─────────────────────────────────────────────────

  _collectIssues(result) {
    const issues = [
      ...(result.truth?.issues || []),
      ...(result.goodness?.issues || []),
      ...(result.beauty?.issues || []),
    ];
    return issues.slice(0, 5).join('; ') || 'unspecified';
  }

  _collectGaps(result) {
    const gaps = [
      ...(result.intersections?.truth_goodness?.gaps || []),
      ...(result.intersections?.goodness_beauty?.gaps || []),
      ...(result.intersections?.truth_beauty?.gaps || []),
    ];
    return gaps.slice(0, 5).join('; ') || 'unspecified gaps';
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
      approvalBufferSize: this.approvalBuffer.length,
      failureBufferSize: this.failureBuffer.length,
      batchSize: this.batchSize,
      model: this.model,
      trackedProjects: Object.keys(this.pipelineFlow).length,
    };
  }

  async shutdown() {
    if (this.healthTimer) clearInterval(this.healthTimer);
    if (this.subscriber) await this.subscriber.disconnect();
    await this.board.disconnect();
    log.info(this.agentId, 'shutdown complete');
  }
}

module.exports = { TeamLeadAgent, PIPELINE_STAGES };
