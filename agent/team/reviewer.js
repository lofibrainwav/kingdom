/**
 * Kingdom Reviewer Agent — Phase 3.2
 * Responsible for:
 * 1. Listening to Coder completion events
 * 2. Reviewing code quality and goal adherence
 * 3. Using rumination-engine logic for deep reflection on failures/successes
 */
const { Blackboard } = require('../core/blackboard');
const { getLogger } = require('../core/logger');
const { ReflexionEngine } = require('../core/ReflexionEngine');
const { RuminationEngine } = require('../memory/rumination-engine');
const log = getLogger();

/** Extract JSON object from LLM response (raw string or pre-parsed object) */
function parseLLMJson(response) {
  if (typeof response === 'object' && response !== null) return response;
  try {
    const match = String(response).match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
  } catch {}
  return null;
}

class ReviewerAgent {
  constructor() {
    this.board = new Blackboard();
    this.llm = new ReflexionEngine();
    this.rumination = new RuminationEngine();
    this.agentId = 'Kingdom_Reviewer';
  }

  async init() {
    await this.board.connect();
    await this.llm.init();
    await this.rumination.init();
    this.subscriber = await this.board.createSubscriber();
    this.subscriber.on('error', (err) => log.error('reviewer', 'Redis sub error', { error: err.message }));
    
    // Listen for code completion from Coder
    await this.subscriber.subscribe('governance:review:requested', (msg) => this.handleTaskComplete(msg));
    
    log.info(this.agentId, 'initialized and ready to review');
    await this.updateStatus('idle', 'Awaiting code for review');
  }

  async handleTaskComplete(message) {
    try {
      const parsed = typeof message === 'string' ? JSON.parse(message) : message;
      const { projectId, taskId, file, content } = parsed;
      log.info(this.agentId, `Reviewing task ${taskId} for project ${projectId} in ${file}`);
      await this.updateStatus('reviewing', `Reviewing ${file}`);

      // 1. Deep Rumination via RuminationEngine (Simplified: analyze code)
      const rawReview = await this.llm.callLLM(
        `Review this code (file: ${file}) for task ${taskId} in project ${projectId}.\n` +
        `Code content:\n${content}\n` +
        'Check for: logic errors, best practices, and task alignment.\n' +
        'Return JSON: { approved: boolean, feedback: string, suggestedFix: string | null }',
        'normal'
      );
      const reviewResult = parseLLMJson(rawReview) || { approved: false, feedback: 'LLM response parse failed' };

      // 2. Save Review to Blackboard
      await this.board.setConfig(`${projectId}:review:${taskId}`, {
        review: reviewResult,
        reviewedAt: Date.now()
      });

      // 3. Forward retry metadata from incoming review request
      const retryMeta = {};
      if (parsed.continuationTaskId) retryMeta.continuationTaskId = parsed.continuationTaskId;
      if (parsed.retry) retryMeta.retry = parsed.retry;
      if (parsed.retryCategory) retryMeta.retryCategory = parsed.retryCategory;
      if (parsed.retryGuardrail) retryMeta.retryGuardrail = parsed.retryGuardrail;

      // 4. Publish result
      if (reviewResult.approved) {
        log.info(this.agentId, `Task ${taskId} APPROVED in ${file}`);
        await this.board.publish('governance:review:approved', { projectId, taskId, file, author: this.agentId, ...retryMeta });
      } else {
        log.warn(this.agentId, `Task ${taskId} REJECTED: ${reviewResult.feedback}`);
        await this.board.publish('governance:review:rejected', { projectId, taskId, file, feedback: reviewResult.feedback, author: this.agentId, ...retryMeta });
      }

      await this.updateStatus('idle', `Finished review for ${file}`);
    } catch (err) {
      log.error(this.agentId, 'Review failed', { error: err.message });
    }
  }

  async updateStatus(state, details) {
    await this.board.updateStatus(this.agentId, {
      state,
      task: details,
      health: 20,
      lastUpdate: Date.now()
    });
  }

  async shutdown() {
    if (this.subscriber) await this.subscriber.disconnect();
    await this.board.disconnect();
    await this.llm.shutdown();
  }
}

if (require.main === module) {
  const reviewer = new ReviewerAgent();
  reviewer.init().catch(err => {
    log.error('Kingdom_Reviewer', 'Startup failed', { error: err.message });
    process.exit(1);
  });

  process.on('SIGINT', async () => {
    await reviewer.shutdown();
    process.exit(0);
  });
}

module.exports = { ReviewerAgent };
