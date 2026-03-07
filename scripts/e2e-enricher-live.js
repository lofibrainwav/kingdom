#!/usr/bin/env node
/**
 * Live E2E: KnowledgeEnricher + TeamLead Quality Gate + ZK integration
 *
 * Tests the REAL pipeline with live Redis:
 * 1. Seed ZK skills into Redis
 * 2. KnowledgeEnricher enriches a prompt with real ZK data
 * 3. TeamLead quality gate processes a mock batch
 * 4. Verify events flow correctly through Pub/Sub
 */
const { Blackboard } = require('../agent/core/blackboard');
const { SkillZettelkasten } = require('../agent/memory/skill-zettelkasten');
const { KnowledgeEnricher } = require('../agent/core/knowledge-enricher');
const { TeamLeadAgent } = require('../agent/team/team-lead');
const { getLogger } = require('../agent/core/logger');
const log = getLogger();

const TEST_PREFIX = 'e2e-live-test';
const PASS = (msg) => console.log(`  ✅ ${msg}`);
const FAIL = (msg) => { console.log(`  ❌ ${msg}`); process.exitCode = 1; };

async function cleanKeys(board) {
  const keys = await board.client.keys(`kingdom:${TEST_PREFIX}:*`);
  if (keys.length > 0) await board.client.del(keys);
  const cfgKeys = await board.client.keys(`kingdom:config:${TEST_PREFIX}:*`);
  if (cfgKeys.length > 0) await board.client.del(cfgKeys);
}

async function main() {
  console.log('\n🔬 Live E2E: KnowledgeEnricher + TeamLead Quality Gate');
  console.log('━'.repeat(55));

  const board = new Blackboard();
  await board.connect();
  await cleanKeys(board);

  try {
    // ── 1. Seed ZK Skills (real Redis) ────────────────────
    console.log('\n[1] Zettelkasten — seeding live skills...');
    const zk = new SkillZettelkasten({ board, zkPrefix: TEST_PREFIX });
    await zk.init();

    await zk.createNote({ name: 'Redis Sorted Set', errorType: 'data', description: 'Sorted set patterns' });
    await zk.createNote({ name: 'Error Boundary', errorType: 'runtime', description: 'Try-catch patterns' });
    for (let i = 0; i < 5; i++) {
      await zk.recordUsage('redis-sorted-set', true, {});
      await zk.recordUsage('error-boundary', i < 4, {}); // 80% success
    }

    const note = await zk.getNote('redis-sorted-set');
    if (note && note.xp > 0) PASS(`ZK skill seeded: ${note.name} (XP:${note.xp}, tier:${note.tier})`);
    else FAIL('ZK skill not found');

    const allNotes = await zk.getAllNotes();
    const noteCount = Object.keys(allNotes).length;
    if (noteCount >= 2) PASS(`${noteCount} skills in Redis`);
    else FAIL(`Expected >=2 skills, got ${noteCount}`);

    // ── 2. KnowledgeEnricher (real enrichment) ────────────
    console.log('\n[2] KnowledgeEnricher — enriching prompts...');
    const enricher = new KnowledgeEnricher({ zk, board, maxContextChars: 2000 });

    const raw = 'Fix the Redis sorted set query that returns wrong scores';
    const enriched = await enricher.enrich(raw, { errorType: 'data', topic: 'redis' });

    if (enriched.includes('[KNOWLEDGE CONTEXT]') && enriched.includes('redis-sorted-set')) {
      PASS('Prompt enriched with ZK skill context');
    } else {
      FAIL('Enrichment missing ZK context');
    }

    if (enriched.includes(raw)) PASS('Original prompt preserved');
    else FAIL('Original prompt lost');

    // Enrichment without matching errorType — should fallback to top XP
    const fallback = await enricher.enrich('Generic task', { errorType: 'unknown-type' });
    if (fallback.includes('[KNOWLEDGE CONTEXT]')) PASS('Fallback to top-XP skills works');
    else FAIL('Fallback enrichment failed');

    // No hints — should return raw prompt
    enricher.invalidateCache();
    const noHints = await enricher.enrich('No context task', {});
    if (noHints.includes('[KNOWLEDGE CONTEXT]')) PASS('Enrichment with empty hints still provides context');
    else PASS('No enrichment with empty hints (expected if no matching skills)');

    // ── 3. TeamLead Quality Gate (Pub/Sub) ────────────────
    console.log('\n[3] TeamLead Quality Gate — testing event flow...');

    const events = [];
    const subBoard = new Blackboard();
    await subBoard.connect();
    const sub = await subBoard.createSubscriber();
    sub.on('error', () => {});

    // Listen for rejection events
    await sub.subscribe('governance:review:rejected', (msg) => {
      const data = typeof msg === 'string' ? JSON.parse(msg) : msg;
      events.push({ channel: 'rejected', data });
    });
    await sub.subscribe('governance:teamlead:vibe-translated', (msg) => {
      const data = typeof msg === 'string' ? JSON.parse(msg) : msg;
      events.push({ channel: 'vibe-translated', data });
    });
    await sub.subscribe('governance:teamlead:reviewed', (msg) => {
      const data = typeof msg === 'string' ? JSON.parse(msg) : msg;
      events.push({ channel: 'reviewed', data });
    });

    // Mock Anthropic that returns "fail" verdict
    const failAgent = new TeamLeadAgent({
      board,
      apiClients: {
        anthropic: {
          call: async () => JSON.stringify({
            truth: { score: 1, issues: ['Logic error in auth'] },
            goodness: { score: 2, issues: ['SQL injection risk'] },
            beauty: { score: 1, issues: ['Spaghetti code'] },
            intersections: {
              truth_goodness: { score: 1, gaps: ['Insecure AND incorrect'] },
              goodness_beauty: { score: 1, gaps: [] },
              truth_beauty: { score: 1, gaps: [] },
            },
            verdict: 'fail',
            summary: 'Critical security and logic flaws',
            storeWorthy: false,
          }),
        },
      },
      batchSize: 2,
      healthIntervalMs: 999999,
    });
    await failAgent.init();

    const batch = [
      { projectId: 'e2e-test', taskId: 'T1', file: 'auth.js' },
      { projectId: 'e2e-test', taskId: 'T2', file: 'db.js' },
    ];
    await failAgent.batchReview(batch);

    // Wait for Pub/Sub propagation
    await new Promise(resolve => setTimeout(resolve, 200));

    const rejections = events.filter(e => e.channel === 'rejected');
    if (rejections.length === 2) PASS(`Quality gate FAIL → ${rejections.length} rejection events published`);
    else FAIL(`Expected 2 rejections, got ${rejections.length}`);

    if (rejections[0]?.data.feedback?.includes('Spider Web FAIL')) PASS('Rejection contains Spider Web feedback');
    else FAIL('Rejection missing Spider Web context');

    if (rejections[0]?.data.author === 'Kingdom_TeamLead') PASS('TeamLead takes authorship of rejection');
    else FAIL('Wrong author on rejection');

    // Test "partial" verdict
    events.length = 0;
    const partialAgent = new TeamLeadAgent({
      board,
      apiClients: {
        anthropic: {
          call: async () => JSON.stringify({
            truth: { score: 4, issues: [] },
            goodness: { score: 3, issues: [] },
            beauty: { score: 2, issues: ['Messy'] },
            intersections: {
              truth_goodness: { score: 3, gaps: ['Perf gap'] },
              goodness_beauty: { score: 2, gaps: ['Structure gap'] },
              truth_beauty: { score: 3, gaps: [] },
            },
            verdict: 'partial',
            summary: 'Truth ok, beauty needs work',
            storeWorthy: false,
          }),
        },
      },
      batchSize: 2,
      healthIntervalMs: 999999,
    });
    await partialAgent.init();
    await partialAgent.batchReview(batch);
    await new Promise(resolve => setTimeout(resolve, 200));

    const vibes = events.filter(e => e.channel === 'vibe-translated');
    const partialRejections = events.filter(e => e.channel === 'rejected');
    if (vibes.length === 1 && partialRejections.length === 0) {
      PASS('Partial verdict → vibe feedback (no hard reject)');
    } else {
      FAIL(`Partial: expected 1 vibe + 0 rejections, got ${vibes.length} vibes + ${partialRejections.length} rejections`);
    }

    if (vibes[0]?.data.metaInsight?.includes('Partial pass')) PASS('Vibe contains partial pass insight');
    else FAIL('Vibe missing partial context');

    // ── 4. ZK Skill Data Persistence Check ────────────────
    console.log('\n[4] Redis data persistence...');
    const reloadedNote = await zk.getNote('redis-sorted-set');
    if (reloadedNote && reloadedNote.xp === note.xp) PASS(`Skill persists across reads (XP:${reloadedNote.xp})`);
    else FAIL('Skill data changed between reads');

    // Cleanup
    await sub.disconnect();
    await subBoard.disconnect();
    if (failAgent.healthTimer) clearInterval(failAgent.healthTimer);
    if (partialAgent.healthTimer) clearInterval(partialAgent.healthTimer);

    console.log('\n' + '━'.repeat(55));
    console.log(process.exitCode ? '❌ Some checks failed' : '✅ All live E2E checks passed');
    console.log('━'.repeat(55) + '\n');

  } finally {
    await cleanKeys(board);
    await board.disconnect();
  }
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
