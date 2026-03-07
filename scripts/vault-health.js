#!/usr/bin/env node
/**
 * vault-health.js — Obsidian Vault health check.
 * Detects orphan notes (no wikilinks), missing frontmatter, and stale notes.
 *
 * Usage:
 *   node scripts/vault-health.js
 *
 * Output: terminal report + bb/04-Daily/vault-health-YYYY-MM-DD.md
 */
const fs = require('fs');
const path = require('path');

const BB = path.join(__dirname, '..', '..');
const VAULT_DAILY = path.join(BB, '04-Daily');
const SKIP_FILES = ['_README.md', '_CONTEXT.md', 'README.md'];
const SKIP_DIRS = ['.obsidian', 'kingdom', 'node_modules', '.git', 'mcp-servers'];

// --- Helpers ---

function walkMd(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.includes(entry.name)) continue;
      results.push(...walkMd(full));
    } else if (entry.name.endsWith('.md') && !SKIP_FILES.includes(entry.name)) {
      results.push(full);
    }
  }
  return results;
}

function relativePath(filePath) {
  return path.relative(BB, filePath);
}

// --- Checks ---

function checkOrphans(files) {
  const orphans = [];
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf-8');
    const hasOutgoing = /\[\[/.test(content);
    if (!hasOutgoing) {
      orphans.push(relativePath(file));
    }
  }
  return orphans;
}

function checkFrontmatter(files) {
  const missing = [];
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf-8');
    if (!content.startsWith('---')) {
      missing.push(relativePath(file));
    }
  }
  return missing;
}

function checkStale(files) {
  const stale = [];
  const now = Date.now();
  const NINETY_DAYS = 90 * 24 * 60 * 60 * 1000;

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf-8');
    const stat = fs.statSync(file);
    const age = now - stat.mtimeMs;

    if (age > NINETY_DAYS && content.includes('status/active')) {
      stale.push({
        path: relativePath(file),
        days: Math.floor(age / (24 * 60 * 60 * 1000)),
      });
    }
  }
  return stale;
}

// --- Report ---

function generateReport(orphans, missingFm, stale) {
  const now = new Date().toISOString().split('T')[0];
  const lines = [];

  lines.push('---');
  lines.push('tags: [type/review, source/vault-health, status/active]');
  lines.push(`created: ${now}`);
  lines.push('author: vault-health');
  lines.push('---');
  lines.push('');
  lines.push(`# Vault Health Report — ${now}`);
  lines.push('');

  // Summary
  lines.push('## Summary');
  lines.push(`| Check | Count |`);
  lines.push(`|-------|-------|`);
  lines.push(`| Orphan notes (no [[wikilinks]]) | ${orphans.length} |`);
  lines.push(`| Missing frontmatter | ${missingFm.length} |`);
  lines.push(`| Stale active notes (>90 days) | ${stale.length} |`);
  lines.push('');

  // Orphans
  if (orphans.length > 0) {
    lines.push('## Orphan Notes');
    lines.push('Notes with no outgoing `[[wikilinks]]`:');
    lines.push('');
    for (const o of orphans) {
      lines.push(`- ${o}`);
    }
    lines.push('');
  }

  // Missing frontmatter
  if (missingFm.length > 0) {
    lines.push('## Missing Frontmatter');
    lines.push('Notes not starting with `---` YAML frontmatter:');
    lines.push('');
    for (const m of missingFm) {
      lines.push(`- ${m}`);
    }
    lines.push('');
  }

  // Stale
  if (stale.length > 0) {
    lines.push('## Stale Active Notes');
    lines.push('Notes tagged `status/active` but not modified in >90 days:');
    lines.push('');
    for (const s of stale) {
      lines.push(`- ${s.path} (${s.days} days)`);
    }
    lines.push('');
  }

  if (orphans.length === 0 && missingFm.length === 0 && stale.length === 0) {
    lines.push('All checks passed. Vault is healthy.');
    lines.push('');
  }

  return lines.join('\n');
}

// --- Main ---

const files = walkMd(BB);
console.log(`Scanning ${files.length} .md files in bb/...\n`);

const orphans = checkOrphans(files);
const missingFm = checkFrontmatter(files);
const stale = checkStale(files);

// Terminal output
console.log(`Orphan notes (no [[wikilinks]]): ${orphans.length}`);
if (orphans.length > 0) orphans.forEach(o => console.log(`  - ${o}`));

console.log(`\nMissing frontmatter: ${missingFm.length}`);
if (missingFm.length > 0) missingFm.forEach(m => console.log(`  - ${m}`));

console.log(`\nStale active notes (>90 days): ${stale.length}`);
if (stale.length > 0) stale.forEach(s => console.log(`  - ${s.path} (${s.days}d)`));

// Write report
const report = generateReport(orphans, missingFm, stale);
const now = new Date().toISOString().split('T')[0];
const reportPath = path.join(VAULT_DAILY, `vault-health-${now}.md`);
fs.mkdirSync(VAULT_DAILY, { recursive: true });
fs.writeFileSync(reportPath, report);
console.log(`\nReport: ${reportPath}`);
