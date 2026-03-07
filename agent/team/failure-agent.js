/**
 * Kingdom Failure Agent — Phase 3.3
 * Responsible for:
 * 1. Listening to task rejections from Reviewer or runtime errors
 * 2. Categorizing failures into 3 types: Task, Skill, Environment
 * 3. Injecting Must-NOT guardrails to prevent recursive failures
 */
const { Blackboard } = require('../core/blackboard');
const { getLogger } = require('../core/logger');
const { ReflexionEngine, parseLLMJson } = require('../core/ReflexionEngine');
const { DedupGuard } = require('../core/dedup');
const log = getLogger();

class FailureAgent {
  constructor(options = {}) {
    this.board = options.board || new Blackboard();
    this.llm = new ReflexionEngine(null, { board: this.board });
    this.agentId = 'Kingdom_Failure';
    this.dedup = new DedupGuard();
  }

  async init() {
    await this.board.connect();
    await this.llm.init();
    this.subscriber = await this.board.createSubscriber();
    this.subscriber.on('error', (err) => log.error('failure-agent', 'Redis sub error', { error: err.message }));
    
    // Listen for code rejection from Reviewer
    await this.subscriber.subscribe('governance:review:rejected', async (msg) => {
      try { await this.handleTaskRejection(msg); } catch (err) { log.error(this.agentId, 'subscribe handler error', { error: err.message }); }
    });
    
    log.info(this.agentId, 'initialized and ready to classify failures');
    await this.updateStatus('idle', 'Awaiting failure reports');
  }

  async handleTaskRejection(message) {
    try {
      const { projectId, taskId, file, feedback } = typeof message === 'string' ? JSON.parse(message) : message;
      const dedupKey = `${projectId}:${taskId}:${file}`;
      if (!this.dedup.check(dedupKey)) {
        log.info(this.agentId, `Skipping duplicate failure classification for ${taskId}`);
        return;
      }

      log.info(this.agentId, `Classifying failure for task ${taskId} in ${file}: ${(feedback ?? '').slice(0, 30)}...`);
      await this.updateStatus('classifying', `Classifying ${taskId}`);

      // 1. Categorize Failure via LLM (3-pillar logic)
      const rawClassification = await this.llm.callLLM(
        `Classify this failure for project ${projectId}, task ${taskId} in file ${file}.\n` +
        `Feedback: ${feedback}\n` +
        'Categorize into: \n' +
        '1. Task Failure (Logic/Requirement mismatch)\n' +
        '2. Skill Failure (Agent lacks specific coding knowledge)\n' +
        '3. Environment Failure (Tool/Workspace/System issue)\n' +
        'Return JSON: { category, reason, mustNotGuardrail }',
        'critical'
      );
      const classification = parseLLMJson(rawClassification) || { category: 'unknown', reason: 'LLM response parse failed', mustNotGuardrail: null };

      // 2. Save Classification and Guardrail to Blackboard
      await this.board.setConfig(`${projectId}:failure:${taskId}`, {
        classification,
        classifiedAt: Date.now()
      });

      // 3. Publish for recovery
      log.warn(this.agentId, `Failure classified as ${classification.category}. Guardrail: ${classification.mustNotGuardrail}`);
      await this.board.publish('governance:failure:retry-requested', {
        projectId,
        taskId,
        category: classification.category,
        guardrail: classification.mustNotGuardrail,
        author: this.agentId,
      });

      await this.updateStatus('idle', `Finished classification for ${taskId}`);
    } catch (err) {
      log.error(this.agentId, 'Classification failed', { error: err.message });
      await this.updateStatus('idle', `Error: ${err.message}`);
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
  const agent = new FailureAgent();
  agent.init().catch(err => {
    log.error('Kingdom_Failure', 'Startup failed', { error: err.message });
    process.exit(1);
  });

  process.on('SIGINT', async () => {
    await agent.shutdown();
    process.exit(0);
  });
}

module.exports = { FailureAgent };
