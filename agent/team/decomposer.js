/**
 * Kingdom Decomposer Agent — Phase 2.2
 * Responsible for:
 * 1. Breaking down high-level goal into a sequence of actionable tasks
 * 2. Using GoT (Graph of Thought) to find optimal build path
 * 3. Handling dependencies between tasks
 */
const { Blackboard } = require('../core/blackboard');
const { getLogger } = require('../core/logger');
const { ReflexionEngine } = require('../core/ReflexionEngine');
const { GoTReasoner } = require('../memory/got-reasoner');
const log = getLogger();

class DecomposerAgent {
  constructor() {
    this.board = new Blackboard();
    this.llm = new ReflexionEngine();
    this.got = new GoTReasoner();
    this.agentId = 'Kingdom_Decomposer';
  }

  async init() {
    await this.board.connect();
    await this.llm.init();
    await this.got.init();
    this.subscriber = await this.board.createSubscriber();
    this.subscriber.on('error', (err) => log.error('decomposer', 'Redis sub error', { error: err.message }));
    
    // Listen for design completion from Architect
    await this.subscriber.subscribe('work:planning:designed', (msg) => this.handleDesignComplete(msg));
    
    log.info(this.agentId, 'initialized and waiting for designs');
    await this.updateStatus('idle', 'Awaiting architect design');
  }

  async handleDesignComplete(message) {
    try {
      const {
        projectId,
        goal,
        architecture,
        taskId = null,
        retry = false,
        retryCategory = null,
        retryGuardrail = null,
      } = typeof message === 'string' ? JSON.parse(message) : message;
      log.info(this.agentId, `Decomposing project ${projectId}: ${goal}`);
      await this.updateStatus('decomposing', `Generating GoT for: ${projectId}`);

      // 1. Generate Task Tree via GoT Reasoner
      // (Simplified here: calling GoT to find optimal task synergy)
      const graph = await this.got.resolveSynergy(goal, architecture);
      
      // 2. Format into Task List for Coder
      const tasks = await this.llm.callLLM(
        `Based on this architecture and GoT synergy: ${JSON.stringify(graph)},\n` +
        `Break down the goal "${goal}" into a flat list of 5-8 actionable tasks.\n` +
        'Return JSON: { tasks: [{id, description, dependencyId}] }',
        'normal'
      );

      // 3. Save tasks to Blackboard
      await this.board.setConfig(`${projectId}:tasks`, {
        plan: tasks,
        status: 'decomposed',
        decomposedAt: Date.now(),
        taskId,
        retry,
        retryCategory,
        retryGuardrail,
      });

      // 4. Trigger Coder to start working
      await this.board.publish('work:planning:decomposed', {
        projectId,
        goal,
        tasks,
        taskId,
        retry,
        retryCategory,
        retryGuardrail,
      });

      log.info(this.agentId, `Decomposition for ${projectId} completed`);
      await this.updateStatus('idle', `Finished decomposition for ${projectId}`);
    } catch (err) {
      log.error(this.agentId, 'Decomposition failed', { error: err.message });
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
  const decomposer = new DecomposerAgent();
  decomposer.init().catch(err => {
    log.error('Octiv_Decomposer', 'Startup failed', { error: err.message });
    process.exit(1);
  });

  process.on('SIGINT', async () => {
    await decomposer.shutdown();
    process.exit(0);
  });
}

module.exports = { DecomposerAgent };
