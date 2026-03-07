/**
 * E2E Boot Test — verifies all 17 agents can init() and shutdown() with live Redis.
 * Requires Redis on localhost:6380 (Docker).
 * Run: node --test test/e2e-boot.test.js
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createClient } = require('redis');

const { PMAgent } = require('../agent/team/pm-agent');
const { ArchitectAgent } = require('../agent/team/architect');
const { DecomposerAgent } = require('../agent/team/decomposer');
const { CoderAgent } = require('../agent/team/coder');
const { ReviewerAgent } = require('../agent/team/reviewer');
const { DeployerAgent } = require('../agent/team/deployer');
const { FailureAgent } = require('../agent/team/failure-agent');
const { SwarmOrchestrator } = require('../agent/team/swarm-orchestrator');
const { WatchdogAgent } = require('../agent/team/watchdog-agent');
const { TaskCloseoutOrchestrator } = require('../agent/core/task-closeout-orchestrator');
const { KnowledgeOperator } = require('../agent/memory/knowledge-operator');
const { VaultBridge } = require('../agent/memory/vault-bridge');
const { RuminationEngine } = require('../agent/memory/rumination-engine');
const { GoTReasoner } = require('../agent/memory/got-reasoner');
const { SkillZettelkasten } = require('../agent/memory/skill-zettelkasten');
const { NotebookLMQueue } = require('../agent/memory/notebooklm-queue');
const { TeamLeadAgent } = require('../agent/team/team-lead');
const { ResearchAgent } = require('../agent/memory/research-agent');

const REDIS_URL = process.env.BLACKBOARD_REDIS_URL || 'redis://localhost:6380';

async function isRedisAvailable() {
  const client = createClient({ url: REDIS_URL });
  try {
    await client.connect();
    await client.ping();
    await client.disconnect();
    return true;
  } catch {
    return false;
  }
}

// Shared dependencies — mirrors team.js exactly
const { Blackboard } = require('../agent/core/blackboard');

function createAgentDefs() {
  const sharedBoard = new Blackboard();
  sharedBoard.markShared();
  const sharedZK = new SkillZettelkasten();
  return {
    sharedBoard,
    agents: [
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
      { name: 'RuminationEngine', factory: () => new RuminationEngine(sharedZK, { board: sharedBoard }), postInit: (inst) => inst.startEventFeed() },
      { name: 'NotebookLMQueue', factory: () => new NotebookLMQueue({ board: sharedBoard }), postInit: (inst) => inst.start() },
      { name: 'TeamLead', factory: () => new TeamLeadAgent({ board: sharedBoard }), postInit: (inst) => inst.start() },
      { name: 'ResearchAgent', factory: () => new ResearchAgent({ board: sharedBoard }), postInit: (inst) => inst.start() },
      {
        name: 'GoTReasoner',
        factory: () => new GoTReasoner(sharedZK, { board: sharedBoard }),
        postInit: async (inst) => {
          const sub = await inst.board.createSubscriber();
          sub.on('error', () => {});
          await sub.subscribe('knowledge:rumination:digested', () => {});
          inst._eventSubscriber = sub;
        },
      },
    ],
  };
}

const EXPECTED_AGENTS = createAgentDefs().agents.length;

describe(`E2E Boot — ${EXPECTED_AGENTS} agents init + shutdown with live Redis`, async () => {
  const available = await isRedisAvailable();
  if (!available) {
    it('SKIP: Redis not available', { skip: 'Redis not reachable on ' + REDIS_URL }, () => {
      assert.fail('Redis required for E2E boot test');
    });
    return;
  }

  it(`should have ${EXPECTED_AGENTS} agent definitions`, () => {
    assert.equal(createAgentDefs().agents.length, EXPECTED_AGENTS);
  });

  it(`all ${EXPECTED_AGENTS} agents boot with sharedBoard then shutdown (team.js simulation)`, async () => {
    const { sharedBoard, agents } = createAgentDefs();
    const instances = [];
    const errors = [];

    for (const agentDef of agents) {
      try {
        const instance = agentDef.factory();
        await instance.init();
        if (agentDef.postInit) await agentDef.postInit(instance);
        instances.push({ name: agentDef.name, instance });
      } catch (err) {
        errors.push({ name: agentDef.name, error: err.message });
      }
    }

    assert.equal(errors.length, 0, `Boot failures: ${JSON.stringify(errors)}`);
    assert.equal(instances.length, EXPECTED_AGENTS, `Only ${instances.length}/${EXPECTED_AGENTS} agents booted`);

    // Shutdown all (reverse order like a real system)
    for (const { instance } of [...instances].reverse()) {
      await instance.shutdown();
    }

    // Finally disconnect sharedBoard
    await sharedBoard.forceDisconnect();
  });
});
