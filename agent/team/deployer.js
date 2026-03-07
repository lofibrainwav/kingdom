/**
 * Kingdom Deployer Agent — Phase 4.2
 * Responsible for:
 * 1. Listening for project completion from PM/Reviewer
 * 2. Automated Git commit and push
 * 3. Notifying external systems (Webhook/Dashboard)
 */
const { Blackboard } = require('../core/blackboard');
const { getLogger } = require('../core/logger');
const cp = require('child_process');
const path = require('path');
const log = getLogger();

class DeployerAgent {
  constructor(options = {}) {
    this.board = options.board || new Blackboard();
    this.agentId = 'Kingdom_Deployer';
    this.projectRoot = path.join(__dirname, '..', '..');
  }

  async init() {
    await this.board.connect();
    this.subscriber = await this.board.createSubscriber();
    this.subscriber.on('error', (err) => log.error('deployer', 'Redis sub error', { error: err.message }));
    
    // Listen for project completion
    await this.subscriber.subscribe('governance:project:approved', async (msg) => {
      try { await this.handleProjectApproved(msg); } catch (err) { log.error(this.agentId, 'subscribe handler error', { error: err.message }); }
    });
    
    log.info(this.agentId, 'initialized and ready for deployment');
    await this.updateStatus('idle', 'Awaiting project approvals');
  }

  async handleProjectApproved(message) {
    try {
      const { projectId, goal } = typeof message === 'string' ? JSON.parse(message) : message;

      // Idempotency guard — skip if already deployed
      const existingStatus = await this.board.getConfig(`${projectId}:status`);
      if (existingStatus === 'deployed') {
        log.info(this.agentId, `Skipping ${projectId} — already deployed`);
        return;
      }

      log.info(this.agentId, `Deploying project ${projectId}: ${goal}`);
      await this.updateStatus('deploying', `Committing ${projectId}`);

      // 1. Git Commit & Push (using execFileSync to prevent shell injection)
      const msg = `🚀 Deploy: ${projectId} - ${goal}`;
      cp.execFileSync('git', ['add', 'workspace/'], { cwd: this.projectRoot, stdio: 'inherit' });
      cp.execFileSync('git', ['commit', '-m', msg], { cwd: this.projectRoot, stdio: 'inherit' });
      cp.execFileSync('git', ['push', 'origin', 'main'], { cwd: this.projectRoot, stdio: 'inherit' });

      // 2. Mark as Deployed in Blackboard
      await this.board.setConfig(`${projectId}:status`, 'deployed');

      // 3. Terminate swarm if one was spawned for this project
      await this.board.publish('execution:swarm:terminate', {
        swarmId: projectId,
        author: this.agentId,
      });

      // 4. Notify Success
      await this.board.publish('execution:deployment:completed', {
        projectId,
        status: 'success',
        timestamp: Date.now(),
        author: this.agentId,
      });

      log.info(this.agentId, `Successfully deployed ${projectId}`);
      await this.updateStatus('idle', `Deployed ${projectId}`);
    } catch (err) {
      log.error(this.agentId, 'Deployment failed', { error: err.message });
      await this.updateStatus('error', `Deployment failed: ${err.message}`);
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
  const deployer = new DeployerAgent();
  deployer.init().catch(err => {
    log.error('Kingdom_Deployer', 'Startup failed', { error: err.message });
    process.exit(1);
  });

  process.on('SIGINT', async () => {
    await deployer.shutdown();
    process.exit(0);
  });
}

module.exports = { DeployerAgent };
