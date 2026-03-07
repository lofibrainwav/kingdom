#!/usr/bin/env node
/**
 * debrief.js — Post-mission debrief (전투 후 경험치 수습)
 *
 * After every battle, a soldier asks:
 *   1. What did we accomplish? (전과)
 *   2. What did we learn? (교훈)
 *   3. What was the cost? (피해)
 *   4. How do we avoid this fight next time? (예방)
 *   5. What XP did we gain? (경험치)
 *
 * Usage:
 *   node scripts/debrief.js                     # since last session-log entry
 *   node scripts/debrief.js --since=abc1234     # since specific commit
 *   node scripts/debrief.js --save              # persist to vault
 *
 * Output: terminal report + optional bb/04-Daily/ entry
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const KINGDOM = path.join(__dirname, '..');
const BB = path.join(KINGDOM, '..');
const VAULT_DAILY = path.join(BB, '04-Daily');
const args = process.argv.slice(2);
const save = args.includes('--save');

const BOLD = '\x1b[1m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';
const NC = '\x1b[0m';

function run(cmd, timeout = 30000) {
  try {
    return execSync(cmd, { cwd: KINGDOM, encoding: 'utf-8', timeout, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch { return ''; }
}

// ── Determine baseline ─────────────────────────────────────────
const sinceArg = args.find(a => a.startsWith('--since='));
let baseline;
if (sinceArg) {
  baseline = sinceArg.split('=')[1];
} else {
  // Find today's first commit or last 10 commits
  const today = new Date().toISOString().split('T')[0];
  const todayCommits = run(`git log --since="${today}" --oneline --reverse`);
  if (todayCommits) {
    baseline = todayCommits.split('\n')[0].split(' ')[0] + '~1';
  } else {
    baseline = 'HEAD~10';
  }
}

// ── 1. ACCOMPLISHMENTS (전과) ──────────────────────────────────
const commits = run(`git log --oneline ${baseline}..HEAD`);
const commitLines = commits ? commits.split('\n').filter(l => l.trim()) : [];
const commitCount = commitLines.length;

const diffStat = run(`git diff --stat ${baseline}..HEAD`);
const filesChanged = diffStat ? (diffStat.match(/(\d+) files? changed/) || [0, 0])[1] : 0;
const insertions = diffStat ? (diffStat.match(/(\d+) insertions?/) || [0, 0])[1] : 0;
const deletions = diffStat ? (diffStat.match(/(\d+) deletions?/) || [0, 0])[1] : 0;

// ── 2. TEST DELTA (전투력 변화) ─────────────────────────────────
const testOutput = run('npm test 2>&1 | tail -10', 120000);
const currentTests = testOutput ? (testOutput.match(/tests\s+(\d+)/) || [0, 0])[1] : '?';
const currentFail = testOutput ? (testOutput.match(/fail\s+(\d+)/) || [0, 0])[1] : '?';

// ── 3. NEW FILES & DELETED FILES ────────────────────────────────
const newFiles = run(`git diff --diff-filter=A --name-only ${baseline}..HEAD`);
const deletedFiles = run(`git diff --diff-filter=D --name-only ${baseline}..HEAD`);
const newFileList = newFiles ? newFiles.split('\n').filter(l => l.trim()) : [];
const deletedFileList = deletedFiles ? deletedFiles.split('\n').filter(l => l.trim()) : [];

// ── 4. PATTERN ANALYSIS (교훈 추출) ─────────────────────────────
const diffContent = run(`git diff ${baseline}..HEAD -- '*.js'`);
const patterns = [];

// New test files
const newTests = newFileList.filter(f => f.includes('test'));
if (newTests.length > 0) patterns.push(`${newTests.length} new test files added`);

// Bug fixes (commit messages with fix/bug)
const fixes = commitLines.filter(l => /fix|bug|patch|repair/i.test(l));
if (fixes.length > 0) patterns.push(`${fixes.length} bug fixes applied`);

// Refactoring
const refactors = commitLines.filter(l => /refactor|clean|simplif|reorganiz/i.test(l));
if (refactors.length > 0) patterns.push(`${refactors.length} refactoring commits`);

// New features
const features = commitLines.filter(l => /feat|add|new|implement|creat/i.test(l));
if (features.length > 0) patterns.push(`${features.length} feature commits`);

// Guard/safety additions
if (diffContent) {
  const guardAdds = (diffContent.match(/^\+.*guard|^\+.*safe|^\+.*check|^\+.*valid/gim) || []).length;
  if (guardAdds > 3) patterns.push(`${guardAdds} safety guards added`);
}

// Automation additions
const autoCommits = commitLines.filter(l => /auto|clock|cron|schedule|pipeline/i.test(l));
if (autoCommits.length > 0) patterns.push(`${autoCommits.length} automation improvements`);

// ── 5. COST ANALYSIS (피해 분석) ─────────────────────────────────
const netLines = parseInt(insertions) - parseInt(deletions);
const complexity = netLines > 500 ? 'HIGH' : netLines > 100 ? 'MEDIUM' : 'LOW';

// ── REPORT ──────────────────────────────────────────────────────
console.log(`\n${BOLD}═══ DEBRIEF (전투 후 경험치 수습) ═══${NC}\n`);

console.log(`${CYAN}[1] Accomplishments (전과)${NC}`);
console.log(`  Commits: ${commitCount}`);
console.log(`  Files changed: ${filesChanged} (+${insertions} -${deletions})`);
console.log(`  New files: ${newFileList.length}`);
console.log(`  Deleted files: ${deletedFileList.length}`);
if (commitCount > 0) {
  console.log(`  ${DIM}Recent:${NC}`);
  for (const c of commitLines.slice(0, 8)) {
    console.log(`    ${DIM}${c}${NC}`);
  }
}

console.log(`\n${CYAN}[2] Combat Power (전투력)${NC}`);
console.log(`  Tests: ${currentTests} (${currentFail} failed)`);
console.log(`  Net complexity: ${netLines > 0 ? '+' : ''}${netLines} lines (${complexity})`);

console.log(`\n${CYAN}[3] Lessons Learned (교훈)${NC}`);
if (patterns.length > 0) {
  for (const p of patterns) console.log(`  ${GREEN}•${NC} ${p}`);
} else {
  console.log(`  ${DIM}No strong patterns detected${NC}`);
}

console.log(`\n${CYAN}[4] Prevention (다음번엔 전투 안 하려면)${NC}`);
if (fixes.length > 0) {
  console.log(`  ${YELLOW}•${NC} ${fixes.length} bugs found — check if similar patterns exist elsewhere`);
  console.log(`  ${YELLOW}•${NC} Consider adding regression tests for each fix`);
}
if (parseInt(deletions) > 100) {
  console.log(`  ${GREEN}•${NC} Good cleanup: ${deletions} lines removed. Less code = less bugs`);
}
if (autoCommits.length > 0) {
  console.log(`  ${GREEN}•${NC} Automation improved — future manual work reduced`);
}
if (patterns.length === 0 && fixes.length === 0) {
  console.log(`  ${DIM}Session was clean — no recurring patterns to address${NC}`);
}

console.log(`\n${CYAN}[5] Session Footprint (경험치 — 숫자가 아닌 흔적)${NC}`);
const footprint = [];
if (commitCount > 0) footprint.push(`${commitCount} commits shipped`);
if (newTests.length > 0) footprint.push(`${newTests.length} new test files`);
if (fixes.length > 0) footprint.push(`${fixes.length} bugs squashed`);
if (autoCommits.length > 0) footprint.push(`${autoCommits.length} automations added`);
if (parseInt(deletions) > parseInt(insertions)) footprint.push(`net ${Math.abs(netLines)} lines removed (lighter)`);
if (footprint.length === 0) footprint.push('quiet session — observation mode');
for (const f of footprint) console.log(`  ${GREEN}•${NC} ${f}`);

console.log('');

// ── SAVE TO VAULT ──────────────────────────────────────────────
if (save) {
  const now = new Date();
  const date = now.toISOString().split('T')[0];
  const time = now.toTimeString().split(' ')[0];

  const md = `---
tags: [type/debrief, source/debrief, status/active]
related: ["[[kingdom/infrastructure]]", "[[metacognition]]"]
created: ${date}
author: debrief
---

# Debrief — ${date} ${time}

## Accomplishments
- **${commitCount}** commits, **${filesChanged}** files changed (+${insertions} -${deletions})
- New files: ${newFileList.length}, Deleted: ${deletedFileList.length}

### Commits
${commitLines.map(c => `- ${c}`).join('\n')}

## Combat Power
- Tests: ${currentTests} (${currentFail} failed)
- Net complexity: ${netLines > 0 ? '+' : ''}${netLines} lines (${complexity})

## Lessons Learned
${patterns.length > 0 ? patterns.map(p => `- ${p}`).join('\n') : '- No strong patterns detected'}

## Prevention
${fixes.length > 0 ? `- ${fixes.length} bugs found — check for similar patterns\n- Add regression tests` : '- Session was clean'}

## Session Footprint
${footprint.map(f => `- ${f}`).join('\n')}

## See Also
- [[kingdom/infrastructure]]
- [[metacognition]]
`;

  fs.mkdirSync(VAULT_DAILY, { recursive: true });
  const reportPath = path.join(VAULT_DAILY, `debrief-${date}.md`);
  fs.writeFileSync(reportPath, md);
  console.log(`${GREEN}Saved: ${reportPath}${NC}\n`);
}
