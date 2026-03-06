/**
 * Kingdom Swarm Orchestrator — Phase 5.1
 * Responsible for:
 * 1. Spawning and managing multiple parallel agent instances
 * 2. Distributing sub-tasks through the Swarm
 * 3. Aggregating results from parallel browser/agent profiles
 */
const { Blackboard } = require('../core/blackboard');
const { getLogger } = require('../core/logger');
const cp = require('child_process');
const path = require('path');
const log = getLogger();

class SwarmOrchestrator {
  constructor() {
    this.board = new Blackboard();
    this.agentId = 'Octiv_Swarm';
    this.children = new Map(); // childId -> process
  }

  async init() {
    await this.board.connect();
    this.subscriber = await this.board.createSubscriber();
    this.subscriber.on('error', (err) => log.error('swarm-orchestrator', 'Redis sub error', { error: err.message }));
    
    // Listen for swarm requests (e.g., from PM or User)
    await this.subscriber.subscribe('execution:swarm:spawn', (msg) => this.handleSpawn(msg));
    await this.subscriber.subscribe('execution:swarm:terminate', (msg) => this.handleTerminate(msg));
    
    log.info(this.agentId, 'initialized and ready to orchestrate swarms');
    await this.updateStatus('idle', 'Ready to spawn swarm');
  }

  async handleSpawn(message) {
    try {
      const { swarmId, agentType, count } = typeof message === 'string' ? JSON.parse(message) : message;
      log.info(this.agentId, `Spawning swarm ${swarmId}: ${count} ${agentType}s`);
      await this.updateStatus('orchestrating', `Spawning ${count} agents for ${swarmId}`);

      for (let i = 0; i < count; i++) {
        const childId = `${swarmId}_${agentType}_${i}`;
        const scriptPath = path.join(__dirname, `${agentType}.js`);
        
        // Spawn child process
        const child = cp.spawn('node', [scriptPath], {
          env: { ...process.env, AGENT_ID: childId, SWARM_ID: swarmId },
          stdio: 'inherit'
        });

        child.on('exit', (code) => {
          log.warn(this.agentId, `Child ${childId} exited with code ${code}`);
          this.children.delete(childId);
        });

        this.children.set(childId, child);
      }

      await this.board.setHashField('swarms', swarmId, {
        status: 'active',
        agentCount: count,
        type: agentType,
        startedAt: Date.now()
      });

    } catch (err) {
      log.error(this.agentId, 'Swarm spawn failed', { error: err.message });
    }
  }

  async handleTerminate(message) {
    const { swarmId } = typeof message === 'string' ? JSON.parse(message) : message;
    log.info(this.agentId, `Terminating swarm ${swarmId}`);
    
    for (const [id, proc] of this.children.entries()) {
      if (id.startsWith(swarmId)) {
        proc.kill();
        this.children.delete(id);
      }
    }
    await this.board.setHashField('swarms', swarmId + ':status', 'terminated');
  }

  async updateStatus(state, details) {
    await this.board.setHashField('agents:status', this.agentId, {
      state,
      task: details,
      health: 20,
      lastUpdate: Date.now()
    });
  }

  async shutdown() {
    for (const proc of this.children.values()) proc.kill();
    if (this.subscriber) await this.subscriber.disconnect();
    await this.board.disconnect();
  }
}

if (require.main === module || process.env.TEST_SWARM_MAIN) {
  const swarm = new SwarmOrchestrator();
  swarm.init().catch(err => {
    log.error('Octiv_Swarm', 'Startup failed', { error: err.message });
    process.exit(1);
  });

  process.on('SIGINT', async () => {
    await swarm.shutdown();
    process.exit(0);
  });
}

module.exports = { SwarmOrchestrator };
