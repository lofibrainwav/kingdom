/**
 * Kingdom Deployer Agent — Phase 4.2
 * Responsible for:
 * 1. Listening for project completion from PM/Reviewer
 * 2. Automated Git commit and push
 * 3. Notifying external systems (Webhook/Dashboard)
 */
const { Blackboard } = require('../core/blackboard');
const { getLogger } = require('../core/logger');
const { execSync } = require('child_process');
const path = require('path');
const log = getLogger();

class DeployerAgent {
  constructor() {
    this.board = new Blackboard();
    this.agentId = 'Octiv_Deployer';
    this.projectRoot = path.join(__dirname, '..', '..');
  }

  async init() {
    await this.board.connect();
    this.subscriber = await this.board.createSubscriber();
    
    // Listen for project completion
    await this.subscriber.subscribe('reviewer:project_approved', (msg) => this.handleProjectApproved(msg));
    
    log.info(this.agentId, 'initialized and ready for deployment');
    await this.updateStatus('idle', 'Awaiting project approvals');
  }

  async handleProjectApproved(message) {
    try {
      const { projectId, goal } = typeof message === 'string' ? JSON.parse(message) : message;
      log.info(this.agentId, `Deploying project ${projectId}: ${goal}`);
      await this.updateStatus('deploying', `Committing ${projectId}`);

      // 1. Git Commit & Push
      const msg = `🚀 Deploy: ${projectId} - ${goal}`;
      execSync(`git add . && git commit -m "${msg}" && git push origin main`, {
        cwd: this.projectRoot,
        stdio: 'inherit'
      });

      // 2. Mark as Deployed in Blackboard
      await this.board.set(`${projectId}:status`, 'deployed');

      // 3. Notify Success
      await this.board.publish('deployer:deployed', {
        projectId,
        status: 'success',
        timestamp: Date.now()
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
    log.error('Octiv_Deployer', 'Startup failed', { error: err.message });
    process.exit(1);
  });

  process.on('SIGINT', async () => {
    await deployer.shutdown();
    process.exit(0);
  });
}

module.exports = { DeployerAgent };
