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
const log = getLogger();

class PMAgent {
  constructor() {
    this.board = new Blackboard();
    this.agentId = 'Octiv_PM';
  }

  async init() {
    await this.board.connect();
    this.subscriber = await this.board.createSubscriber();
    this.subscriber.on('error', (err) => log.error('pm-agent', 'Redis sub error', { error: err.message }));
    
    // Listen for manual assignments from Discord/Dashboard
    await this.subscriber.subscribe('commands:assign', (msg) => this.handleManualAssign(msg));
    
    log.info(this.agentId, 'initialized and listening for assignments');
    await this.updateStatus('idle', 'Ready for new projects');
  }

  async handleManualAssign(message) {
    try {
      const data = typeof message === 'string' ? JSON.parse(message) : message;
      const { task, author } = data;
      
      log.info(this.agentId, `Received task from ${author}: ${task}`);
      await this.updateStatus('processing', `Decomposing: ${task.slice(0, 30)}...`);

      // 1. Post to Blackboard for the team
      const projectId = `project:${Date.now()}`;
      await this.board.setConfig(projectId, {
        goal: task,
        status: 'init',
        createdAt: Date.now(),
        author: author
      });

      // 2. Trigger Architect to define context
      await this.board.publish('pm:project_init', {
        projectId,
        goal: task,
        agentId: this.agentId
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
    log.error('Octiv_PM', 'Startup failed', { error: err.message });
    process.exit(1);
  });

  process.on('SIGINT', async () => {
    await pm.shutdown();
    process.exit(0);
  });
}

module.exports = { PMAgent };
