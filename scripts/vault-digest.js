#!/usr/bin/env node
/**
 * Vault Digest — Bridge between Obsidian wikilinks and Kingdom SkillZettelkasten
 *
 * Solves the "two-world problem":
 *   - Obsidian bb/03-Skills/ has human knowledge skills (debugging, golden-synergy, etc.)
 *   - Kingdom agent/vault/04-Skills/ has AI atomic skills (code-reviewer, test-runner, etc.)
 *   - This script reads Obsidian wikilink co-occurrences and feeds them as experiences
 *     into RuminationEngine, so vault graph connections accumulate XP.
 *
 * Data flow:
 *   1. Scan bb/ .md files for [[wikilinks]]
 *   2. Build co-occurrence graph (which skills appear together in related fields)
 *   3. Map Obsidian skill names → Kingdom skill IDs where possible
 *   4. Feed co-occurrences as experiences → RuminationEngine → digest → XP
 *   5. Create bridge notes for unmapped Obsidian skills → Kingdom atomic notes
 *
 * Usage:
 *   node scripts/vault-digest.js                # full digest
 *   node scripts/vault-digest.js --scan-only    # just show wikilink graph
 *   node scripts/vault-digest.js --dry-run      # show what would be fed, don't write
 *
 * Env:
 *   OBSIDIAN_BASE_URL (default: http://127.0.0.1:27124)
 *   OBSIDIAN_API_KEY
 *   When Obsidian is offline, falls back to direct file reads from bb/
 */
const path = require('path');
const fsp = require('fs').promises;
const { Blackboard } = require('../agent/core/blackboard');
const { SkillZettelkasten } = require('../agent/memory/skill-zettelkasten');
const { RuminationEngine } = require('../agent/memory/rumination-engine');

const BB_ROOT = path.resolve(__dirname, '..', '..');
const SCAN_DIRS = ['01-Projects', '02-Research', '03-Skills', '04-Daily', '05-Operations'];
const OBSIDIAN_BASE = process.env.OBSIDIAN_BASE_URL || 'http://127.0.0.1:27124';
const OBSIDIAN_TOKEN = process.env.OBSIDIAN_API_KEY || '';

// Mapping: Obsidian skill/concept names → Kingdom atomic skill IDs
const SKILL_MAP = {
  // Direct mappings (03-Skills/ → atomic skills)
  'debugging': 'code-reviewer',
  'accuracy-rules': 'lint-checker',
  'golden-synergy': 'llm-prompter',
  'compounding-engineering': 'redis-publisher',
  'context-architecture': 'llm-prompter',
  'guardrail-pattern': 'env-checker',
  'gmail-collection-skill': 'api-caller',
  'session-cleanup-checklist': 'file-writer',
  // Concept → skill mappings (various folders)
  'kingdom/infrastructure': 'redis-publisher',
  'kingdom/patterns': 'code-reviewer',
  'infrastructure': 'redis-publisher',
  'patterns': 'code-reviewer',
  'metacognition': 'llm-prompter',
  'knowledge-os': 'markdown-formatter',
  'obsidian-playbook': 'markdown-formatter',
  'weekly-questions': 'api-caller',
  // Research notes → closest atomic skill
  'agentic-engineering-9pillars': 'llm-prompter',
  'afo-kingdom-v6-blueprint': 'llm-prompter',
  'agentic-second-brain-blueprint': 'llm-prompter',
  'agentic-second-brain-engineering': 'llm-prompter',
  'architecting-ai-autonomy': 'llm-prompter',
  'notebooklm-masterclass': 'api-caller',
  'obsidian-context-engine': 'markdown-formatter',
  'agentic-ai-ecosystem': 'llm-prompter',
  'memory-skill-compounding': 'redis-publisher',
  'weekly-2026-w10': 'markdown-formatter',
  // Daily/session notes
  'session-log': 'file-writer',
  'weekly-review': 'markdown-formatter',
};

// ── File Scanner (Obsidian API with file fallback) ────────────────

async function scanVaultFiles() {
  const files = [];

  for (const dir of SCAN_DIRS) {
    const dirPath = path.join(BB_ROOT, dir);
    try {
      const entries = await walkDir(dirPath);
      files.push(...entries);
    } catch {
      // Directory doesn't exist, skip
    }
  }

  return files;
}

async function walkDir(dir) {
  const results = [];
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;

    if (entry.isDirectory()) {
      results.push(...await walkDir(fullPath));
    } else if (entry.name.endsWith('.md') && !entry.name.startsWith('_')) {
      results.push(fullPath);
    }
  }
  return results;
}

// ── Wikilink Extraction ───────────────────────────────────────────

function extractWikilinks(content) {
  const links = new Set();
  // Match [[link]] patterns (both in YAML related field and body)
  const re = /\[\[([^\]|]+?)(?:\|[^\]]*?)?\]\]/g;
  let match;
  while ((match = re.exec(content)) !== null) {
    // Normalize: strip path prefixes, lowercase
    const link = match[1].trim().toLowerCase().replace(/^.*\//, '');
    links.add(link);
  }
  return [...links];
}

function extractNoteName(filePath) {
  return path.basename(filePath, '.md').toLowerCase();
}

// ── Co-occurrence Graph Builder ───────────────────────────────────

function buildCoOccurrenceGraph(fileLinks) {
  // fileLinks: Map<filename, Set<linkedNotes>>
  // Co-occurrence = two notes that appear as links in the same file
  const coOccurrences = new Map(); // "a::b" → count

  for (const [, links] of fileLinks) {
    const arr = [...links];
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const key = [arr[i], arr[j]].sort().join('::');
        coOccurrences.set(key, (coOccurrences.get(key) || 0) + 1);
      }
    }
  }

  return coOccurrences;
}

// ── Experience Generator ──────────────────────────────────────────

function generateExperiences(coOccurrences) {
  const experiences = [];

  for (const [pair, count] of coOccurrences) {
    const [a, b] = pair.split('::');

    // Map to Kingdom skill IDs
    const skillA = SKILL_MAP[a];
    const skillB = SKILL_MAP[b];

    // Only generate experiences for mapped skills
    if (!skillA || !skillB || skillA === skillB) continue;

    // Each co-occurrence = one successful experience
    for (let i = 0; i < Math.min(count, 5); i++) {
      experiences.push({
        skillUsed: skillA,
        coSkills: [skillB],
        errorType: 'vault-synapse',
        succeeded: true,
        source: 'vault-digest',
        projectId: 'knowledge-os',
        vaultPair: `${a} + ${b}`,
      });
    }
  }

  return experiences;
}

// ── Bridge Note Creator ───────────────────────────────────────────

function findUnmappedConcepts(fileLinks) {
  const allLinkedNotes = new Set();
  for (const [, links] of fileLinks) {
    for (const link of links) allLinkedNotes.add(link);
  }

  const unmapped = [];
  for (const note of allLinkedNotes) {
    if (!(note in SKILL_MAP)) {
      unmapped.push(note);
    }
  }
  return unmapped;
}

// ── Main Pipeline ─────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const scanOnly = args.includes('--scan-only');
  const dryRun = args.includes('--dry-run');

  console.log('=== Vault Digest — Two-World Bridge ===\n');

  // Phase 1: Scan vault files
  console.log('Phase 1: Scanning vault files...');
  const files = await scanVaultFiles();
  console.log(`  Found ${files.length} .md files across ${SCAN_DIRS.join(', ')}\n`);

  // Phase 2: Extract wikilinks per file
  console.log('Phase 2: Extracting wikilinks...');
  const fileLinks = new Map();
  let totalLinks = 0;

  for (const filePath of files) {
    const content = await fsp.readFile(filePath, 'utf8');
    const links = extractWikilinks(content);
    if (links.length > 0) {
      const name = extractNoteName(filePath);
      fileLinks.set(name, new Set(links));
      totalLinks += links.length;
    }
  }
  console.log(`  ${fileLinks.size} files with wikilinks, ${totalLinks} total links\n`);

  // Phase 3: Build co-occurrence graph
  console.log('Phase 3: Building co-occurrence graph...');
  const coOccurrences = buildCoOccurrenceGraph(fileLinks);
  console.log(`  ${coOccurrences.size} unique co-occurrence pairs\n`);

  // Display top co-occurrences
  const sorted = [...coOccurrences.entries()].sort((a, b) => b[1] - a[1]);
  console.log('  Top co-occurrences:');
  for (const [pair, count] of sorted.slice(0, 15)) {
    const [a, b] = pair.split('::');
    const mapA = SKILL_MAP[a] || '(unmapped)';
    const mapB = SKILL_MAP[b] || '(unmapped)';
    console.log(`    ${count}x  ${a} + ${b}  →  [${mapA}] + [${mapB}]`);
  }

  if (scanOnly) {
    // Show unmapped concepts
    const unmapped = findUnmappedConcepts(fileLinks);
    console.log(`\n  Unmapped concepts (${unmapped.length}):`);
    for (const u of unmapped.sort()) {
      console.log(`    - ${u}`);
    }
    console.log('\n=== Scan complete (--scan-only) ===');
    return;
  }

  // Phase 4: Generate experiences
  console.log('\nPhase 4: Generating experiences from co-occurrences...');
  const experiences = generateExperiences(coOccurrences);
  console.log(`  Generated ${experiences.length} experiences for Kingdom pipeline`);

  if (experiences.length === 0) {
    console.log('  No mappable co-occurrences found. Update SKILL_MAP to bridge more concepts.');
    return;
  }

  for (const exp of experiences) {
    console.log(`    ${exp.skillUsed} + ${exp.coSkills[0]} (from: ${exp.vaultPair})`);
  }

  if (dryRun) {
    console.log('\n=== Dry run complete (--dry-run) ===');
    return;
  }

  // Phase 5: Feed to RuminationEngine
  console.log('\nPhase 5: Feeding to RuminationEngine...');
  const board = new Blackboard();
  await board.connect();

  try {
    const zk = new SkillZettelkasten({ board });
    await zk.init();

    const engine = new RuminationEngine(zk, { board });

    for (const exp of experiences) {
      engine.feed(exp);
    }
    console.log(`  Fed ${experiences.length} experiences`);

    // Digest
    const result = await engine.digest();
    console.log(`\n  Digestion result:`);
    console.log(`    Processed: ${result.digested}`);
    console.log(`    Insights: ${result.insights.length}`);
    console.log(`    Actions: ${result.actions.length}`);

    for (const insight of result.insights) {
      console.log(`    [${insight.type}] ${insight.insight}`);
    }

    // Verify (use Blackboard getHash which adds 'kingdom:' prefix)
    const allNotes = await board.getHash('zettelkasten:notes');
    const noteCount = Object.keys(allNotes).length;
    const linkKeys = await board.client.keys('kingdom:zettelkasten:links:*');
    console.log(`\n  Post-digest state:`);
    console.log(`    Skills: ${noteCount}`);
    console.log(`    Link records: ${linkKeys.length}`);

  } finally {
    await board.disconnect();
  }

  console.log('\n=== Vault Digest Complete ===');
}

main().catch(err => {
  console.error('Fatal:', err.message, err.stack);
  process.exit(1);
});
