/**
 * Kingdom PM Agent — Phase 2.1
 * Interface between USER and the Agent Team.
 * Responsible for:
 * 1. Listening to USER/Discord commands
 * 2. Decomposing high-level goals into the Blackboard
 * 3. Orchestrating Architect and Decomposer via Redis Pub/Sub
 */
const { Blackboard } = require('../core/blackboard');
const { getLogger } = require('../core/logger');
const { TaskRunner } = require('../core/task-runner');
const log = getLogger();

class PMAgent {
  constructor() {
    this.board = new Blackboard();
    this.agentId = 'Kingdom_PM';
    this.taskRunner = new TaskRunner({ board: this.board });
  }

  async init() {
    await this.board.connect();
    this.subscriber = await this.board.createSubscriber();
    this.subscriber.on('error', (err) => log.error('pm-agent', 'Redis sub error', { error: err.message }));
    
    // Listen for manual assignments from Discord/Dashboard
    await this.subscriber.subscribe('work:intake', (msg) => this.handleManualAssign(msg));
    
    log.info(this.agentId, 'initialized and listening for assignments');
    await this.updateStatus('idle', 'Ready for new projects');
  }

  async handleManualAssign(message) {
    try {
      const data = typeof message === 'string' ? JSON.parse(message) : message;
      const { task, author } = data;

      log.info(this.agentId, `Received task from ${author}: ${task}`);
      await this.updateStatus('processing', `Decomposing: ${task.slice(0, 30)}...`);

      const projectId = data.retry && data.projectId ? data.projectId : `project:${Date.now()}`;
      const goal = data.goal || task;

      await this.board.setConfig(projectId, {
        goal,
        status: data.retry ? 'retry_intake' : 'init',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        author,
        retry: data.retry ? {
          taskId: data.taskId,
          category: data.retryCategory,
          guardrail: data.retryGuardrail,
        } : undefined,
      });

      if (data.retry && data.projectId && data.taskId) {
        await this.taskRunner.markRetryClaimed({
          projectId: data.projectId,
          taskId: data.taskId,
          agentId: this.agentId,
        });
      }

      await this.board.publish('work:planning:init', {
        projectId,
        goal,
        agentId: this.agentId,
        author: this.agentId,
        taskId: data.taskId,
        retry: Boolean(data.retry),
        retryCategory: data.retryCategory,
        retryGuardrail: data.retryGuardrail,
      });

      log.info(this.agentId, `Project ${projectId} initiated`);
    } catch (err) {
      log.error(this.agentId, 'Failed to handle assignment', { error: err.message });
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
  }
}

if (require.main === module) {
  const pm = new PMAgent();
  pm.init().catch(err => {
    log.error('Kingdom_PM', 'Startup failed', { error: err.message });
    process.exit(1);
  });

  process.on('SIGINT', async () => {
    await pm.shutdown();
    process.exit(0);
  });
}

module.exports = { PMAgent };
