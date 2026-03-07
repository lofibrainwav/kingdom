#!/usr/bin/env node
/**
 * Kingdom Team Launcher
 * Spawned by start.js — initializes all 17 agents with graceful shutdown.
 */
const { getLogger } = require('./core/logger');
const { Blackboard } = require('./core/blackboard');
const T = require('../config/timeouts');
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
const { VaultBridge } = require('./memory/vault-bridge');
const { RuminationEngine } = require('./memory/rumination-engine');
const { GoTReasoner } = require('./memory/got-reasoner');
const { SkillZettelkasten } = require('./memory/skill-zettelkasten');
const { NotebookLMQueue } = require('./memory/notebooklm-queue');
const { TeamLeadAgent } = require('./team/team-lead');
const { ResearchAgent } = require('./memory/research-agent');
const { createMcpClients } = require('./memory/mcp-client-factory');

// Shared dependencies — single Redis connection + single Zettelkasten
const sharedBoard = new Blackboard();
sharedBoard.markShared(); // Prevent individual agents from disconnecting
const sharedZK = new SkillZettelkasten({ board: sharedBoard });

const AGENTS = [
  { name: 'PMAgent', factory: () => new PMAgent({ board: sharedBoard }) },
  { name: 'Architect', factory: () => new ArchitectAgent({ board: sharedBoard }) },
  { name: 'Decomposer', factory: () => new DecomposerAgent({ board: sharedBoard, zettelkasten: sharedZK }) },
  { name: 'Coder', factory: () => new CoderAgent({ board: sharedBoard }) },
  { name: 'Reviewer', factory: () => new ReviewerAgent({ board: sharedBoard }) },
  { name: 'Deployer', factory: () => new DeployerAgent({ board: sharedBoard }) },
  { name: 'Failure', factory: () => new FailureAgent({ board: sharedBoard }) },
  { name: 'Swarm', factory: () => new SwarmOrchestrator({ board: sharedBoard }) },
  { name: 'Watchdog', factory: () => new WatchdogAgent({ board: sharedBoard }) },
  { name: 'TaskCloseout', factory: () => new TaskCloseoutOrchestrator({ board: sharedBoard }), postInit: (inst) => inst.start() },
  { name: 'KnowledgeOperator', factory: () => new KnowledgeOperator({ board: sharedBoard, zettelkasten: sharedZK }), postInit: (inst) => inst.start() },
  { name: 'VaultBridge', factory: () => new VaultBridge({ board: sharedBoard }), postInit: (inst) => inst.start() },
  {
    name: 'RuminationEngine',
    factory: () => new RuminationEngine(sharedZK, { board: sharedBoard }),
    postInit: (inst) => inst.startEventFeed(),
  },
  { name: 'NotebookLMQueue', factory: () => new NotebookLMQueue({ board: sharedBoard }), postInit: (inst) => inst.start() },
  { name: 'TeamLead', factory: () => new TeamLeadAgent({ board: sharedBoard }), postInit: (inst) => inst.start() },
  { name: 'ResearchAgent', factory: () => {
    const { grokClient, nlmClient } = createMcpClients();
    return new ResearchAgent({ board: sharedBoard, grokClient, nlmClient });
  }, postInit: (inst) => inst.start() },
  {
    name: 'GoTReasoner',
    factory: () => new GoTReasoner(sharedZK, { board: sharedBoard }),
    postInit: async (inst) => {
      const sub = await inst.board.createSubscriber();
      sub.on('error', (err) => log.error('team', 'GoT subscriber error', { error: err.message }));
      await sub.subscribe('knowledge:rumination:digested', async (message) => {
        try {
          const data = typeof message === 'string' ? JSON.parse(message) : (message || {});
          if (data.insightCount > 0) {
            await inst.fullReasoningCycle();
          }
        } catch (err) {
          log.error('team', 'GoT trigger error', { error: err.message });
        }
      });
      inst._eventSubscriber = sub;
      log.info('team', 'GoTReasoner subscribed to knowledge:rumination:digested');
    },
  },
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

const SHUTDOWN_TIMEOUT_MS = T.TEAM_SHUTDOWN_TIMEOUT_MS;

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

  // Disconnect shared Redis last — after all agents have released subscribers
  try {
    await sharedBoard.forceDisconnect();
    log.info('team', 'sharedBoard disconnected');
  } catch (err) {
    log.error('team', `sharedBoard disconnect error: ${err.message}`);
  }

  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', (err) => {
  log.error('team', `Uncaught exception: ${err.message}`, { stack: err.stack });
  shutdown('uncaughtException').catch(() => process.exit(1));
});
process.on('unhandledRejection', (reason) => {
  log.error('team', `Unhandled rejection: ${reason}`);
  shutdown('unhandledRejection').catch(() => process.exit(1));
});

main().catch((err) => {
  log.error('team', `Fatal: ${err.message}`);
  process.exit(1);
});
