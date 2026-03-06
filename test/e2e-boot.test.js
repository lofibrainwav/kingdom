/**
 * E2E Boot Test — verifies all 15 agents can init() and shutdown() with live Redis.
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

// Shared ZK like team.js
function createAgentDefs() {
  const sharedZK = new SkillZettelkasten();
  return [
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
    { name: 'KnowledgeOperator', factory: () => new KnowledgeOperator({ zettelkasten: sharedZK }), postInit: (inst) => inst.start() },
    { name: 'VaultBridge', factory: () => new VaultBridge(), postInit: (inst) => inst.start() },
    { name: 'RuminationEngine', factory: () => new RuminationEngine(sharedZK), postInit: (inst) => inst.startEventFeed() },
    { name: 'NotebookLMQueue', factory: () => new NotebookLMQueue(), postInit: (inst) => inst.start() },
    {
      name: 'GoTReasoner',
      factory: () => new GoTReasoner(sharedZK),
      postInit: async (inst) => {
        const sub = await inst.board.createSubscriber();
        sub.on('error', () => {});
        await sub.subscribe('knowledge:rumination:digested', () => {});
        inst._eventSubscriber = sub;
      },
    },
  ];
}

describe('E2E Boot — 15 agents init + shutdown with live Redis', async () => {
  const available = await isRedisAvailable();
  if (!available) {
    it('SKIP: Redis not available', { skip: 'Redis not reachable on ' + REDIS_URL }, () => {
      assert.fail('Redis required for E2E boot test');
    });
    return;
  }

  it('should have 15 agent definitions', () => {
    assert.equal(createAgentDefs().length, 15);
  });

  const agentDefs = createAgentDefs();
  for (const agentDef of agentDefs) {
    it(`${agentDef.name} — init + postInit + shutdown`, async () => {
      const instance = agentDef.factory();
      await instance.init();
      if (agentDef.postInit) await agentDef.postInit(instance);
      await instance.shutdown();
    });
  }

  it('all 15 agents boot sequentially then shutdown (team.js simulation)', async () => {
    const defs = createAgentDefs();
    const instances = [];
    const errors = [];

    for (const agentDef of defs) {
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
    assert.equal(instances.length, 15, `Only ${instances.length}/15 agents booted`);

    // Shutdown all (reverse order like a real system)
    for (const { instance } of [...instances].reverse()) {
      await instance.shutdown();
    }
  });
});
