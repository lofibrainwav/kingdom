/**
 * Kingdom Architect Agent — Phase 2.1
 * Responsible for:
 * 1. Defining project technical stack and architecture
 * 2. Creating folder structures and initial README
 * 3. Setting the context for the Decomposer and Coders
 */
const { Blackboard } = require('../core/blackboard');
const { getLogger } = require('../core/logger');
const { ReflexionEngine } = require('../core/ReflexionEngine');
const log = getLogger();

class ArchitectAgent {
  constructor() {
    this.board = new Blackboard();
    this.llm = new ReflexionEngine();
    this.agentId = 'Kingdom_Architect';
  }

  async init() {
    await this.board.connect();
    await this.llm.init();
    this.subscriber = await this.board.createSubscriber();
    this.subscriber.on('error', (err) => log.error('architect', 'Redis sub error', { error: err.message }));
    
    // Listen for project initiation from PM
    await this.subscriber.subscribe('work:planning:init', (msg) => this.handleProjectInit(msg));
    
    log.info(this.agentId, 'initialized and waiting for projects');
    await this.updateStatus('idle', 'Awaiting PM initiation');
  }

  async handleProjectInit(message) {
    try {
      const {
        projectId,
        goal,
        taskId = null,
        retry = false,
        retryCategory = null,
        retryGuardrail = null,
      } = typeof message === 'string' ? JSON.parse(message) : message;
      log.info(this.agentId, `Architecting project ${projectId}: ${goal}`);
      await this.updateStatus('designing', `Architecting: ${projectId}`);

      // 1. Generate Architecture via LLM
      const context = await this.llm.callLLM(
        `Design a technical architecture for this project: ${goal}.\n` +
        'Return detailed tech stack, folder structure, and key design decisions.',
        'normal'
      );

      // 2. Save Architecture to Blackboard
      await this.board.setConfig(`${projectId}:architecture`, {
        design: context,
        status: 'designed',
        designedAt: Date.now(),
        taskId,
        retry,
        retryCategory,
        retryGuardrail,
      });

      // 3. Trigger Decomposer to break down tasks
      await this.board.publish('work:planning:designed', {
        projectId,
        goal,
        architecture: context,
        taskId,
        retry,
        retryCategory,
        retryGuardrail,
        author: this.agentId,
      });

      log.info(this.agentId, `Architecture for ${projectId} completed`);
      await this.updateStatus('idle', `Finished architecture for ${projectId}`);
    } catch (err) {
      log.error(this.agentId, 'Architecture design failed', { error: err.message });
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
  const architect = new ArchitectAgent();
  architect.init().catch(err => {
    log.error('Kingdom_Architect', 'Startup failed', { error: err.message });
    process.exit(1);
  });

  process.on('SIGINT', async () => {
    await architect.shutdown();
    process.exit(0);
  });
}

module.exports = { ArchitectAgent };
