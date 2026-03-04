/**
 * Octiv Team Orchestrator — start and manage the full agent team
 * Usage: node agent/team.js
 */
const { LeaderAgent } = require('./leader');
const { BuilderAgent } = require('./builder');
const { SafetyAgent } = require('./safety');
const { Blackboard } = require('./blackboard');
const { MemoryLogger } = require('./memory-logger');
const { SkillPipeline } = require('./skill-pipeline');
const { ReflexionEngine } = require('./ReflexionEngine');
const { ExplorerAgent } = require('./roles/ExplorerAgent');
const { createApiClients } = require('./api-clients');
const { SkillZettelkasten } = require('./skill-zettelkasten');
const { RuminationEngine } = require('./rumination-engine');
const { GoTReasoner } = require('./got-reasoner');
const { ZettelkastenHooks } = require('./zettelkasten-hooks');

const TEAM_SIZE = 3; // number of builder agents

function monitorGathering(board, teamSize, intervalMs = 5000) {
  const checkInterval = setInterval(async () => {
    try {
      let arrivedCount = 0;
      for (let i = 1; i <= teamSize; i++) {
        const ac = await board.getACProgress(`builder-0${i}`);
        if (ac && ac['AC-4']) {
          const parsed = JSON.parse(ac['AC-4']);
          if (parsed.status === 'done') arrivedCount++;
        }
      }
      if (arrivedCount >= teamSize) {
        clearInterval(checkInterval);
        await board.publish('team:ac4', {
          author: 'team',
          status: 'done',
          message: `All ${teamSize} builders gathered at shelter`,
        });
        console.log(`🏠 AC-4 complete: all ${teamSize} builders at shelter`);
      }
    } catch (err) {
      // Ignore polling errors
    }
  }, intervalMs);
  return checkInterval;
}

async function main() {
  console.log('');
  console.log('🎮 Octiv Agent Team starting');
  console.log('═══════════════════════════════════════');
  console.log(`  PaperMC: ${process.env.MC_HOST || 'localhost'}:${process.env.MC_PORT || 25565} (offline)`);
  const redisDisplay = (process.env.BLACKBOARD_REDIS_URL || 'redis://localhost:6380').replace(/:\/\/[^@]*@/, '://***@');
  console.log(`  Redis:   ${redisDisplay}`);
  console.log('  Team:    Leader + Builder x3 + Safety + Explorer');
  console.log('═══════════════════════════════════════');
  console.log('');

  const board = new Blackboard();
  try {
    await board.connect();
  } catch (err) {
    console.error('FATAL: Redis unavailable:', err.message);
    process.exit(1);
  }

  // AC-7: Persistent disk logging — shared across all agents
  const logger = new MemoryLogger();

  // Task A: Create API clients from environment (Anthropic primary, Groq fallback)
  const apiClients = createApiClients();

  // Learning pipeline: ReflexionEngine (with real API clients) → SkillPipeline → Leader
  const reflexion = new ReflexionEngine(apiClients);
  await reflexion.init();
  const pipeline = new SkillPipeline(reflexion);
  await pipeline.init();

  // Learning brain: Zettelkasten + Rumination + GoT
  const zettelkasten = new SkillZettelkasten({ logger });
  await zettelkasten.init();
  const rumination = new RuminationEngine(zettelkasten, { logger });
  await rumination.init();
  const got = new GoTReasoner(zettelkasten, { logger });
  await got.init();
  const zkHooks = new ZettelkastenHooks(zettelkasten, rumination, got, { logger });
  await zkHooks.init();

  // Wire Zettelkasten hooks to skill pipeline
  zkHooks.wireToSkillPipeline(pipeline);

  // Record Octiv team initialization state
  await board.publish('team:status', {
    author: 'team',
    status: 'initializing',
    members: ['leader', 'builder-01', 'builder-02', 'builder-03', 'safety', 'explorer'],
    mission: 'first-day-survival v1.3.1',
  });

  // 1. Start Leader (with learning pipeline)
  const leader = new LeaderAgent(TEAM_SIZE);
  leader.setLogger(logger);
  leader.setSkillPipeline(pipeline);
  await leader.init();
  zkHooks.wireToLeader(leader);

  // 2. Start Safety (with logger)
  const safety = new SafetyAgent();
  safety.setLogger(logger);
  await safety.init();

  // 3. Start Builder team (sequentially to prevent server overload)
  const builders = [];
  for (let i = 1; i <= TEAM_SIZE; i++) {
    await new Promise(r => setTimeout(r, 2000)); // 2s interval
    const builder = new BuilderAgent({ id: `builder-0${i}` });
    builder.setLogger(logger);
    builder.setSkillPipeline(pipeline); // Task B: enable skill feedback loop
    try {
      await builder.init();
      zkHooks.wireToBuilder(builder);
      builders.push(builder);
      console.log(`✅ Builder-0${i} started`);
    } catch (err) {
      console.error(`❌ Builder-0${i} failed to start: ${err.message}`);
    }
  }

  if (builders.length === 0) {
    console.error('FATAL: No builders started. Exiting.');
    process.exit(1);
  }

  // 4. Start Explorer (world scout — uses Blackboard, not direct mineflayer)
  const explorer = new ExplorerAgent({ id: 'explorer-01', maxRadius: 200 });
  await explorer.init();
  console.log('✅ Explorer-01 started');

  // Subscribe to skills:emergency — handle safety alerts and skill pipeline events
  const emergencySubscriber = await board.createSubscriber();
  emergencySubscriber.subscribe('octiv:skills:emergency', async (message) => {
    try {
      const data = JSON.parse(message);
      logger.logEvent('team', { type: 'emergency', ...data }).catch(e => console.error('[Log]', e.message));
      console.warn(`[Team] ⚠️  Emergency: ${data.failureType || data.newSkill || 'unknown'}`);

      // Task C: Increment leader failure counter on safety threats
      if (data.failureType) {
        leader.consecutiveTeamFailures++;
        await leader.checkReflexionTrigger();
      }

      // If safety triggered skill creation, attempt to generate a skill
      if (data.triggerSkillCreation && data.failureType) {
        const result = await pipeline.generateFromFailure({
          error: data.failureType,
          errorType: data.failureType,
          agentId: data.agentId || 'unknown',
        });
        if (result.success) {
          await leader.injectLearnedSkill(result.skill);
          logger.logEvent('team', { type: 'skill_created', skill: result.skill }).catch(e => console.error('[Log]', e.message));
        }
      }
    } catch (err) {
      console.error('[Team] emergency handler error:', err.message);
    }
  });

  await board.publish('team:status', {
    author: 'team',
    status: 'running',
    mission: 'first-day-survival v1.3.1',
    startedAt: new Date().toISOString(),
  });

  logger.logEvent('team', { type: 'started', members: TEAM_SIZE + 2 }).catch(e => console.error('[Log]', e.message));

  console.log('');
  console.log('✅ Full team running. Press Ctrl+C to stop.');
  console.log('');

  // Monitor AC-4: all builders gathered at shelter
  monitorGathering(board, TEAM_SIZE);

  // Graceful shutdown handler
  process.on('SIGINT', async () => {
    console.log('\n🛑 Team shutting down...');
    const forceExit = setTimeout(() => {
      console.error('Shutdown timeout (10s), forcing exit');
      process.exit(1);
    }, 10000);

    try {
      logger.logEvent('team', { type: 'shutdown' }).catch(e => console.error('[Log]', e.message));
      await leader.shutdown();
      await safety.shutdown();
      await explorer.shutdown();
      for (const b of builders) await b.shutdown();
      await emergencySubscriber.unsubscribe();
      await emergencySubscriber.disconnect();
      await zkHooks.shutdown();
      await got.shutdown();
      await rumination.shutdown();
      await zettelkasten.shutdown();
      await pipeline.shutdown();
      await reflexion.shutdown();
      await board.disconnect();
    } catch (err) {
      console.error('Shutdown error:', err.message);
    }

    clearTimeout(forceExit);
    process.exit(0);
  });

  // Log team status periodically (every 30s)
  setInterval(async () => {
    const status = await board.get('team:status');
    if (status) {
      console.log(`[Team] status: ${status.status} | mission: ${status.mission}`);
    }
  }, 30000);
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { monitorGathering, main };
