/**
 * Kingdom Watchdog Agent — Phase 5.2
 * Responsible for:
 * 1. Monitoring health of all agents in the Blackboard
 * 2. Detecting unresponsive or crashed agents
 * 3. Auto-restarting core system components (Yi Sun-sin spirit)
 */
const { Blackboard } = require('../core/blackboard');
const { getLogger } = require('../core/logger');
const { exec } = require('child_process');
const path = require('path');
const log = getLogger();

class WatchdogAgent {
  constructor() {
    this.board = new Blackboard();
    this.agentId = 'Octiv_Watchdog';
    this.checkInterval = 30000; // 30s
    this.unresponsiveThreshold = 60000; // 60s
  }

  async init() {
    await this.board.connect();
    log.info(this.agentId, 'initialized and monitoring system health');
    
    this.timer = setInterval(() => this.checkSystemHealth(), this.checkInterval);
    await this.updateStatus('active', 'Monitoring agent heartbeats');
  }

  async checkSystemHealth() {
    try {
      const statuses = await this.board.getAllStatuses();
      const now = Date.now();

      for (const [id, status] of Object.entries(statuses)) {
        if (id === this.agentId) continue;

        const lastUpdate = status.lastUpdate || 0;
        const diff = now - lastUpdate;

        if (diff > this.unresponsiveThreshold) {
          log.warn(this.agentId, `Agent ${id} is unresponsive (${Math.round(diff/1000)}s). Attempting recovery...`);
          await this.recoverAgent(id);
        }
      }
    } catch (err) {
      log.error(this.agentId, 'Health check failed', { error: err.message });
    }
  }

  async recoverAgent(agentId) {
    // Mapping agentId to script filename
    const nameMap = {
      'Octiv_PM': 'pm-agent.js',
      'Octiv_Architect': 'architect.js',
      'Octiv_Decomposer': 'decomposer.js',
      'Octiv_Coder': 'coder.js',
      'Octiv_Reviewer': 'reviewer.js',
      'Octiv_Failure': 'failure-agent.js',
      'Octiv_Deployer': 'deployer.js',
      'Octiv_Swarm': 'swarm-orchestrator.js'
    };

    const script = nameMap[agentId];
    if (script) {
      log.info(this.agentId, `Restarting ${agentId} via ${script}`);
      const scriptPath = path.join(__dirname, script);
      
      // In a real system, we'd use PM2 or a systemd service, 
      // but for this autonomous build, we'll use a direct node spawn.
      exec(`node ${scriptPath} &`, (err) => {
        if (err) log.error(this.agentId, `Recovery failed for ${agentId}`, { error: err.message });
      });

      await this.board.publish('watchdog:recovery', {
        agentId,
        timestamp: Date.now(),
        action: 'restart'
      });
    }
  }

  async updateStatus(state, details) {
    await this.board.updateStatus(this.agentId, {
      state,
      task: details,
      health: 20, // Watchdog is always the last line of defense
      lastUpdate: Date.now()
    });
  }

  async shutdown() {
    if (this.timer) clearInterval(this.timer);
    await this.board.disconnect();
  }
}

if (require.main === module) {
  const watchdog = new WatchdogAgent();
  watchdog.init().catch(err => {
    log.error('Octiv_Watchdog', 'Startup failed', { error: err.message });
    process.exit(1);
  });

  process.on('SIGINT', async () => {
    await watchdog.shutdown();
    process.exit(0);
  });
}

module.exports = { WatchdogAgent };
