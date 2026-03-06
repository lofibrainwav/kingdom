#!/usr/bin/env node
/**
 * Kingdom Team Launcher
 * Spawned by start.js — initializes all 9 agents with graceful shutdown.
 */
const { getLogger } = require('./core/logger');
const log = getLogger();

const { PMAgent } = require('./team/pm-agent');
const { ArchitectAgent } = require('./team/architect');
const { DecomposerAgent } = require('./team/decomposer');
const { CoderAgent } = require('./team/coder');
const { ReviewerAgent } = require('./team/reviewer');
const { DeployerAgent } = require('./team/deployer');
const { FailureAgent } = require('./team/failure-agent');
const { SwarmOrchestrator } = require('./team/swarm-orchestrator');
const { WatchdogAgent } = require('./team/watchdog-agent');
const { TaskCloseoutOrchestrator } = require('./core/task-closeout-orchestrator');
const { KnowledgeOperator } = require('./memory/knowledge-operator');

const AGENTS = [
  { name: 'PMAgent', factory: () => new PMAgent() },
  { name: 'Architect', factory: () => new ArchitectAgent() },
  { name: 'Decomposer', factory: () => new DecomposerAgent() },
  { name: 'Coder', factory: () => new CoderAgent() },
  { name: 'Reviewer', factory: () => new ReviewerAgent() },
  { name: 'Deployer', factory: () => new DeployerAgent() },
  { name: 'Failure', factory: () => new FailureAgent() },
  { name: 'Swarm', factory: () => new SwarmOrchestrator() },
  { name: 'Watchdog', factory: () => new WatchdogAgent() },
  { name: 'TaskCloseout', factory: () => new TaskCloseoutOrchestrator(), postInit: (inst) => inst.start() },
  { name: 'KnowledgeOperator', factory: () => new KnowledgeOperator(), postInit: (inst) => inst.start() },
];

const instances = [];

async function main() {
  log.info('team', `Initializing ${AGENTS.length} agents...`);

  for (const agent of AGENTS) {
    try {
      const instance = agent.factory();
      await instance.init();
      if (agent.postInit) await agent.postInit(instance);
      instances.push({ name: agent.name, instance });
      log.info('team', `${agent.name} initialized`);
    } catch (err) {
      log.error('team', `${agent.name} init failed: ${err.message}`);
    }
  }

  log.info('team', `${instances.length}/${AGENTS.length} agents running`);
}

const SHUTDOWN_TIMEOUT_MS = 5000;

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info('team', `Shutting down (${signal})...`);

  const timeout = (ms) => new Promise((_, reject) =>
    setTimeout(() => reject(new Error('shutdown timeout')), ms)
  );

  for (const { name, instance } of instances) {
    try {
      await Promise.race([instance.shutdown(), timeout(SHUTDOWN_TIMEOUT_MS)]);
      log.info('team', `${name} stopped`);
    } catch (err) {
      log.error('team', `${name} shutdown error: ${err.message}`);
    }
  }

  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

main().catch((err) => {
  log.error('team', `Fatal: ${err.message}`);
  process.exit(1);
});
