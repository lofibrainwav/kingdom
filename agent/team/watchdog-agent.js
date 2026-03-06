/**
 * Kingdom Watchdog Agent — Phase 5.2
 * Responsible for:
 * 1. Monitoring health of all agents in the Blackboard
 * 2. Detecting unresponsive or crashed agents
 * 3. Auto-restarting core system components (Yi Sun-sin spirit)
 */
const { Blackboard } = require('../core/blackboard');
const { getLogger } = require('../core/logger');
const T = require('../../config/timeouts');
const { exec } = require('child_process');
const path = require('path');
const log = getLogger();

class WatchdogAgent {
  constructor() {
    this.board = new Blackboard();
    this.agentId = 'Kingdom_Watchdog';
    this.checkInterval = T.WATCHDOG_CHECK_INTERVAL_MS;
    this.unresponsiveThreshold = T.WATCHDOG_UNRESPONSIVE_THRESHOLD_MS;
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
          await this.board.publish('governance:safety:threat', {
            author: this.agentId,
            threatType: 'agent-unresponsive',
            agentId: id,
            downtime: diff,
            action: 'recovery-initiated',
          });
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
      'Kingdom_PM': 'pm-agent.js',
      'Kingdom_Architect': 'architect.js',
      'Kingdom_Decomposer': 'decomposer.js',
      'Kingdom_Coder': 'coder.js',
      'Kingdom_Reviewer': 'reviewer.js',
      'Kingdom_Failure': 'failure-agent.js',
      'Kingdom_Deployer': 'deployer.js',
      'Kingdom_Swarm': 'swarm-orchestrator.js'
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

      await this.board.publish('governance:watchdog:recovery', {
        agentId,
        timestamp: Date.now(),
        action: 'restart',
        author: this.agentId,
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
    log.error('Kingdom_Watchdog', 'Startup failed', { error: err.message });
    process.exit(1);
  });

  process.on('SIGINT', async () => {
    await watchdog.shutdown();
    process.exit(0);
  });
}

module.exports = { WatchdogAgent };
