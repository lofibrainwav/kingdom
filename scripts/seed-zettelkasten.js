#!/usr/bin/env node
/**
 * Seed Zettelkasten — Load atomic skills into Redis + feed experiences
 *
 * Phase 1: Read vault/04-Skills/atomic/*.md → Redis zettelkasten:notes
 * Phase 2: Feed realistic experiences → trigger RuminationEngine digest
 * Phase 3: Verify pipeline (XP accumulated, links created, insights generated)
 *
 * Usage:
 *   node scripts/seed-zettelkasten.js              # full pipeline
 *   node scripts/seed-zettelkasten.js --load-only   # phase 1 only
 *   node scripts/seed-zettelkasten.js --feed-only   # phase 2+3 only
 *   node scripts/seed-zettelkasten.js --verify       # phase 3 only
 */
const path = require('path');
const fsp = require('fs').promises;
const { Blackboard } = require('../agent/core/blackboard');
const { SkillZettelkasten } = require('../agent/memory/skill-zettelkasten');
const { RuminationEngine } = require('../agent/memory/rumination-engine');

const VAULT_ATOMIC = path.join(__dirname, '..', 'agent', 'vault', '04-Skills', 'atomic');
const ZK_PREFIX = 'zettelkasten';

// Skill descriptions — human-readable purpose for each atomic skill
const SKILL_DESCRIPTIONS = {
  'api-caller': 'External API integration and HTTP request handling',
  'code-reviewer': 'Code analysis for bugs, security issues, and improvements',
  'env-checker': 'Environment variable validation and configuration verification',
  'file-writer': 'File system operations — create, write, and manage files',
  'git-commit': 'Git version control — staging, committing, branch management',
  'lint-checker': 'Code style and formatting enforcement via ESLint/Prettier',
  'llm-prompter': 'LLM prompt engineering and AI reasoning orchestration',
  'markdown-formatter': 'Markdown document generation and formatting',
  'redis-publisher': 'Redis pub/sub event publishing and data persistence',
  'test-runner': 'Test execution, assertion validation, and coverage tracking',
};

// Realistic experience scenarios based on actual agent workflows
const EXPERIENCE_SCENARIOS = [
  // code-reviewer + test-runner co-occurrence (quality pattern)
  { skillUsed: 'code-reviewer', coSkills: ['test-runner'], errorType: 'quality', succeeded: true, source: 'seed' },
  { skillUsed: 'code-reviewer', coSkills: ['test-runner'], errorType: 'quality', succeeded: true, source: 'seed' },
  { skillUsed: 'code-reviewer', coSkills: ['test-runner'], errorType: 'quality', succeeded: true, source: 'seed' },
  { skillUsed: 'code-reviewer', coSkills: ['test-runner'], errorType: 'quality', succeeded: false, source: 'seed' },

  // git-commit + lint-checker co-occurrence (deploy pattern)
  { skillUsed: 'git-commit', coSkills: ['lint-checker'], errorType: 'deployment', succeeded: true, source: 'seed' },
  { skillUsed: 'git-commit', coSkills: ['lint-checker'], errorType: 'deployment', succeeded: true, source: 'seed' },
  { skillUsed: 'git-commit', coSkills: ['lint-checker'], errorType: 'deployment', succeeded: true, source: 'seed' },

  // api-caller + env-checker co-occurrence (integration pattern)
  { skillUsed: 'api-caller', coSkills: ['env-checker'], errorType: 'integration', succeeded: true, source: 'seed' },
  { skillUsed: 'api-caller', coSkills: ['env-checker'], errorType: 'integration', succeeded: false, source: 'seed' },
  { skillUsed: 'api-caller', coSkills: ['env-checker'], errorType: 'integration', succeeded: true, source: 'seed' },
  { skillUsed: 'api-caller', coSkills: ['env-checker'], errorType: 'integration', succeeded: true, source: 'seed' },

  // redis-publisher + markdown-formatter (knowledge pattern)
  { skillUsed: 'redis-publisher', coSkills: ['markdown-formatter'], errorType: 'knowledge', succeeded: true, source: 'seed' },
  { skillUsed: 'redis-publisher', coSkills: ['markdown-formatter'], errorType: 'knowledge', succeeded: true, source: 'seed' },
  { skillUsed: 'redis-publisher', coSkills: ['markdown-formatter'], errorType: 'knowledge', succeeded: true, source: 'seed' },

  // file-writer + markdown-formatter (output pattern)
  { skillUsed: 'file-writer', coSkills: ['markdown-formatter'], errorType: 'output', succeeded: true, source: 'seed' },
  { skillUsed: 'file-writer', coSkills: ['markdown-formatter'], errorType: 'output', succeeded: true, source: 'seed' },
  { skillUsed: 'file-writer', coSkills: ['markdown-formatter'], errorType: 'output', succeeded: true, source: 'seed' },

  // llm-prompter solo usage (reasoning)
  { skillUsed: 'llm-prompter', coSkills: [], errorType: 'reasoning', succeeded: true, source: 'seed' },
  { skillUsed: 'llm-prompter', coSkills: [], errorType: 'reasoning', succeeded: false, source: 'seed' },
  { skillUsed: 'llm-prompter', coSkills: [], errorType: 'reasoning', succeeded: true, source: 'seed' },

  // Failure scenarios (gomguk candidates)
  { skillUsed: 'env-checker', coSkills: [], errorType: 'config', succeeded: false, source: 'seed' },
  { skillUsed: 'env-checker', coSkills: [], errorType: 'config', succeeded: false, source: 'seed' },
  { skillUsed: 'env-checker', coSkills: [], errorType: 'config', succeeded: false, source: 'seed' },
  { skillUsed: 'env-checker', coSkills: [], errorType: 'config', succeeded: false, source: 'seed' },
];

// ── Phase 1: Load seed skills from vault → Redis ──────────────────

async function loadSeeds(board) {
  console.log('\n=== Phase 1: Load Seed Skills → Redis ===\n');

  const files = await fsp.readdir(VAULT_ATOMIC);
  const mdFiles = files.filter(f => f.endsWith('.md'));
  let loaded = 0;

  for (const file of mdFiles) {
    const content = await fsp.readFile(path.join(VAULT_ATOMIC, file), 'utf8');
    const note = parseFrontmatter(content, file);
    if (!note) continue;

    // Check if already exists
    const existing = await board.getHashField(`${ZK_PREFIX}:notes`, note.id);
    if (existing) {
      console.log(`  Skip (exists): ${note.id}`);
      continue;
    }

    await board.setHashField(`${ZK_PREFIX}:notes`, note.id, note);
    loaded++;
    console.log(`  Loaded: ${note.id} (${note.tier}, XP:${note.xp})`);
  }

  const total = await board.client.hLen(`${ZK_PREFIX}:notes`);
  console.log(`\nPhase 1 complete: ${loaded} new, ${total} total in Redis`);
  return total;
}

function parseFrontmatter(content, filename) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;

  const yaml = match[1];
  const get = (key) => {
    const m = yaml.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
    return m ? m[1].replace(/^["']|["']$/g, '').trim() : null;
  };
  const getNum = (key) => Number(get(key)) || 0;
  const getArr = (key) => {
    const m = yaml.match(new RegExp(`^${key}:\\s*\\[(.*)\\]`, 'm'));
    return m ? m[1].split(',').map(s => s.replace(/["' ]/g, '').trim()).filter(Boolean) : [];
  };

  const id = get('id') || filename.replace('.md', '');
  return {
    id,
    name: get('name') || id,
    description: SKILL_DESCRIPTIONS[id] || '',
    errorType: get('error_type') || 'unknown',
    createdBy: get('created_by') || 'seed-script',
    createdAt: getNum('created_at') || Date.now(),
    code: '',
    xp: getNum('xp'),
    tier: get('tier') || 'Novice',
    uses: getNum('uses'),
    successes: getNum('successes'),
    failures: getNum('failures'),
    successRate: parseFloat(get('success_rate') || get('successRate')) || 0,
    links: [],
    backlinks: [],
    compoundOf: null,
    digestCount: getNum('digest_count'),
    lastDigestedAt: null,
    ruminationNotes: [],
    tags: getArr('tags'),
    status: get('status') || 'active',
  };
}

// ── Phase 2: Feed experiences → Digest ────────────────────────────

async function feedExperiences(board) {
  console.log('\n=== Phase 2: Feed Experiences → Digest ===\n');

  const zk = new SkillZettelkasten({ board });
  await zk.init();

  const engine = new RuminationEngine(zk, { board });
  // Don't call engine.init() — it starts timers. We manually control.

  // Feed all scenarios
  for (const scenario of EXPERIENCE_SCENARIOS) {
    engine.feed(scenario);
  }
  console.log(`  Fed ${EXPERIENCE_SCENARIOS.length} experiences into rumen`);
  console.log(`  Buffer size: ${engine.rawBuffer.length}`);

  // Trigger digestion
  const result = await engine.digest();
  console.log(`\n  Digestion complete:`);
  console.log(`    Experiences processed: ${result.digested}`);
  console.log(`    Insights discovered: ${result.insights.length}`);
  console.log(`    Actions taken: ${result.actions.length}`);

  for (const insight of result.insights) {
    console.log(`    [${insight.type}] ${insight.insight}`);
  }

  for (const action of result.actions) {
    if (action.action === 'link_strengthened') {
      console.log(`    Link: ${action.skills[0]} <-> ${action.skills[1]}`);
    } else if (action.action === 'xp_added') {
      console.log(`    XP+: ${action.skill} (${action.reason})`);
    } else if (action.action === 'new_skill_needed') {
      console.log(`    New skill needed for: ${action.errorType}`);
    }
  }

  // Deep rumination pass
  console.log('\n  Running deep rumination (gomguk mode)...');
  const deepResult = await engine.deepRuminate();
  if (deepResult && deepResult.length > 0) {
    console.log(`    Deep discoveries: ${deepResult.length}`);
    for (const d of deepResult) {
      console.log(`    [${d.type}] ${d.skillA} + ${d.skillB} (strength: ${d.linkStrength})`);
    }
  } else {
    console.log('    No compound candidates yet (need more co-occurrences)');
  }

  return result;
}

// ── Phase 3: Verify ───────────────────────────────────────────────

async function verify(board) {
  console.log('\n=== Phase 3: Verify Pipeline State ===\n');

  // Use Blackboard methods (they add 'kingdom:' prefix) instead of raw client
  const raw = await board.getHash(`${ZK_PREFIX}:notes`);
  const entries = Object.entries(raw);
  let totalXP = 0;
  let totalLinks = 0;
  let tieredUp = 0;

  for (const [id, json] of entries) {
    try {
      const note = JSON.parse(json);
      totalXP += note.xp;
      totalLinks += (note.links || []).length;
      if (note.tier !== 'Novice') tieredUp++;
      const linkInfo = note.links.length > 0 ? ` links:[${note.links.join(',')}]` : '';
      console.log(`  ${note.tier.padEnd(12)} ${note.id.padEnd(22)} XP:${String(note.xp).padStart(3)} uses:${String(note.uses).padStart(2)} rate:${(note.successRate * 100).toFixed(0)}%${linkInfo}`);
    } catch {}
  }

  // Check links in Redis (need raw client with prefix for KEYS)
  const allKeys = await board.client.keys(`kingdom:${ZK_PREFIX}:links:*`);
  const noteCount = entries.length;
  console.log(`\n  Summary:`);
  console.log(`    Total skills: ${noteCount}`);
  console.log(`    Total XP: ${totalXP}`);
  console.log(`    Wiki-links: ${totalLinks}`);
  console.log(`    Link records: ${allKeys.length}`);
  console.log(`    Tiered-up skills: ${tieredUp}`);

  return { noteCount, totalXP, totalLinks, linkRecords: allKeys.length, tieredUp };
}

// ── Main ──────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const loadOnly = args.includes('--load-only');
  const feedOnly = args.includes('--feed-only');
  const verifyOnly = args.includes('--verify');

  const board = new Blackboard();
  await board.connect();

  try {
    if (!feedOnly && !verifyOnly) {
      await loadSeeds(board);
    }

    if (!loadOnly && !verifyOnly) {
      await feedExperiences(board);
    }

    await verify(board);
  } finally {
    await board.disconnect();
  }

  console.log('\n=== Seed Zettelkasten Complete ===');
}

main().catch(err => {
  console.error('Fatal:', err.message, err.stack);
  process.exit(1);
});
