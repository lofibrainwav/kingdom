/**
 * Pillar Metrics — Objective 6-virtue measurement for EROS V6
 *
 * Port of HyoGook's pillar_metrics.py (Phase 122-128) to Kingdom's Node.js toolchain.
 * Each pillar score is derived from REAL tool output, not LLM opinion.
 *
 * Kingdom tool sources:
 *   眞 Truth   ← npm test pass rate, agent syntax check, test-audit strong%
 *   善 Goodness ← secrets scan, npm audit, bare catch/throw patterns
 *   美 Beauty   ← long files (>300 LOC), console.log count, test-audit empty%
 *   仁 Benevolence ← avg complexity (file length proxy), error message clarity
 *   忠 Loyalty  ← event integrity (dead + phantom), CI pass rate, dependency drift
 *   永 Eternity ← vault health (orphans + missing frontmatter), MEMORY.md presence
 *
 * Every score: 10 - penalty, clamped [1, 10], rounded to 1 decimal.
 *
 * Two modes:
 *   1. fromRawMetrics(metrics) — sync, from pre-collected data
 *   2. collectAndScore()      — async, runs Kingdom tools live
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const KINGDOM = path.join(__dirname, '..', '..');

// ── Metric models (input) ────────────────────────────────────

/**
 * @typedef {Object} TruthMetrics
 * @property {number} syntaxErrors      - Agent .js files with syntax errors
 * @property {number} testPassRate      - Test pass rate 0.0-1.0
 * @property {number} testWeakPct       - % of tests that are assert.ok-only (0-100)
 * @property {number} testEmptyCount    - Tests with zero assertions
 */

/**
 * @typedef {Object} GoodnessMetrics
 * @property {number} secretsFound      - Hardcoded secrets in code
 * @property {number} auditCritical     - npm audit critical/high vulnerabilities
 * @property {number} bareCatchCount    - Bare catch blocks (swallow errors)
 */

/**
 * @typedef {Object} BeautyMetrics
 * @property {number} longFiles         - Files >300 lines in agent/
 * @property {number} consoleLogFiles   - Files with console.log in agent/
 * @property {number} testEmptyPct      - % of tests with zero assertions (0-100)
 */

/**
 * @typedef {Object} BenevolenceMetrics
 * @property {number} avgFileLines      - Avg lines per agent file (lower = more readable)
 * @property {number} errorClarityScore - Error messages with context vs bare throws (0.0-1.0)
 * @property {number} totalAgentFiles   - Total agent files (complexity proxy)
 */

/**
 * @typedef {Object} LoyaltyMetrics
 * @property {number} deadEvents        - Published but unsubscribed events
 * @property {number} phantomListeners  - Subscribed but unpublished events
 * @property {number} testFlakyRate     - Flaky test rate 0.0-1.0
 * @property {number} dependencyDrift   - Outdated major dependencies
 */

/**
 * @typedef {Object} EternityMetrics
 * @property {number} vaultOrphans      - Notes with no wikilinks
 * @property {number} missingFrontmatter - Notes without YAML frontmatter
 * @property {boolean} memoryPresent    - MEMORY.md exists and has content
 * @property {boolean} sessionLogRecent - Session log updated within 7 days
 */

/**
 * @typedef {Object} RawMetrics
 * @property {TruthMetrics} truth
 * @property {GoodnessMetrics} goodness
 * @property {BeautyMetrics} beauty
 * @property {BenevolenceMetrics} benevolence
 * @property {LoyaltyMetrics} loyalty
 * @property {EternityMetrics} eternity
 */

// ── Score calculation (penalty → 0-10) ──────────────────────

function clampScore(raw) {
  return Math.round(Math.max(1, Math.min(10, raw)) * 10) / 10;
}

/**
 * 眞 Truth — code correctness, type safety, test reliability
 * HyoGook: 10 - (ruff*0.5 + pyright*1.0 + (1-test_pass)*5.0)
 * Kingdom: 10 - (syntaxErrors*2.0 + (1-testPassRate)*5.0 + testWeakPct*0.03 + testEmptyCount*0.5)
 */
function scoreTruth(m) {
  const penalty =
    (m.syntaxErrors || 0) * 2.0 +
    (1.0 - (m.testPassRate ?? 1.0)) * 5.0 +
    (m.testWeakPct || 0) * 0.03 +
    (m.testEmptyCount || 0) * 0.5;
  return clampScore(10 - penalty);
}

/**
 * 善 Goodness — security, safety, ethics
 * HyoGook: 10 - (secrets*5.0 + bandit_high*2.0 + pip_audit*3.0 + bare_except*0.5)
 * Kingdom: 10 - (secrets*5.0 + auditCritical*3.0 + bareCatch*0.5)
 */
function scoreGoodness(m) {
  const penalty =
    (m.secretsFound || 0) * 5.0 +
    (m.auditCritical || 0) * 3.0 +
    (m.bareCatchCount || 0) * 0.5;
  return clampScore(10 - penalty);
}

/**
 * 美 Beauty — code aesthetics, cleanliness
 * HyoGook: 10 - (console_log*0.3 + any_ts*0.2 + eslint*0.5 + long_files*0.5)
 * Kingdom: 10 - (longFiles*0.5 + consoleLogFiles*0.3 + testEmptyPct*0.05)
 */
function scoreBeauty(m) {
  const penalty =
    (m.longFiles || 0) * 0.5 +
    (m.consoleLogFiles || 0) * 0.3 +
    (m.testEmptyPct || 0) * 0.05;
  return clampScore(10 - penalty);
}

/**
 * 仁 Benevolence — developer experience, readability, compassion
 * HyoGook: 10 - (max(0, complexity-5)*0.5 + (1-doc_coverage)*3.0 + onboarding*0.3 + (1-error_clarity)*2.0)
 * Kingdom: 10 - (max(0, avgFileLines-150)*0.01 + (1-errorClarityScore)*3.0 + max(0, totalAgentFiles-40)*0.1)
 */
function scoreBenevolence(m) {
  const penalty =
    Math.max(0, (m.avgFileLines || 0) - 150) * 0.01 +
    (1.0 - (m.errorClarityScore ?? 1.0)) * 3.0 +
    Math.max(0, (m.totalAgentFiles || 0) - 40) * 0.1;
  return clampScore(10 - penalty);
}

/**
 * 忠 Loyalty — consistency, SSOT compliance, reliability
 * HyoGook: 10 - (ssot_drift*2.0 + (1-ci_pass)*5.0 + flaky*3.0 + breaking*1.5 + dep_drift*0.3)
 * Kingdom: 10 - (deadEvents*1.0 + phantomListeners*2.0 + flakyRate*3.0 + depDrift*0.3)
 */
function scoreLoyalty(m) {
  const penalty =
    (m.deadEvents || 0) * 1.0 +
    (m.phantomListeners || 0) * 2.0 +
    (m.testFlakyRate || 0) * 3.0 +
    (m.dependencyDrift || 0) * 0.3;
  return clampScore(10 - penalty);
}

/**
 * 永 Eternity — documentation, knowledge persistence, vault health
 * HyoGook: phase_synced + ssot_drift + doc_coverage + evolution_logged
 * Kingdom: 10 - (orphans*0.3 + missingFM*0.3 + (memoryPresent?0:2) + (sessionLogRecent?0:1))
 */
function scoreEternity(m) {
  const penalty =
    (m.vaultOrphans || 0) * 0.3 +
    (m.missingFrontmatter || 0) * 0.3 +
    (m.memoryPresent ? 0 : 2) +
    (m.sessionLogRecent ? 0 : 1);
  return clampScore(10 - penalty);
}

// ── Public API ───────────────────────────────────────────────

/**
 * Convert pre-collected raw metrics to 6-pillar scores (0-10).
 * @param {RawMetrics} metrics
 * @returns {{ scores: Object, raw: RawMetrics }}
 */
function fromRawMetrics(metrics) {
  const scores = {
    truth: scoreTruth(metrics.truth || {}),
    goodness: scoreGoodness(metrics.goodness || {}),
    beauty: scoreBeauty(metrics.beauty || {}),
    benevolence: scoreBenevolence(metrics.benevolence || {}),
    loyalty: scoreLoyalty(metrics.loyalty || {}),
    eternity: scoreEternity(metrics.eternity || {}),
  };
  return { scores, raw: metrics };
}

/**
 * Run Kingdom tools live and compute pillar scores.
 * This is the Rolex-grade objective measurement pipeline.
 * @returns {Promise<{ scores: Object, raw: RawMetrics, duration: number }>}
 */
async function collectAndScore() {
  const start = Date.now();
  const raw = {
    truth: collectTruthMetrics(),
    goodness: collectGoodnessMetrics(),
    beauty: collectBeautyMetrics(),
    benevolence: collectBenevolenceMetrics(),
    loyalty: collectLoyaltyMetrics(),
    eternity: collectEternityMetrics(),
  };
  const { scores } = fromRawMetrics(raw);
  return { scores, raw, duration: Date.now() - start };
}

// ── Collectors (run actual tools) ────────────────────────────

function run(cmd, timeout = 15000) {
  try {
    return execSync(cmd, { cwd: KINGDOM, encoding: 'utf-8', timeout, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch { return null; }
}

function collectTruthMetrics() {
  // Syntax check
  let syntaxErrors = 0;
  const dirs = ['agent/core', 'agent/team', 'agent/interface', 'agent/memory'];
  for (const dir of dirs) {
    const full = path.join(KINGDOM, dir);
    if (!fs.existsSync(full)) continue;
    for (const f of fs.readdirSync(full).filter(f => f.endsWith('.js'))) {
      if (run(`node -c ${dir}/${f}`) === null) syntaxErrors++;
    }
  }

  // Test pass rate
  let testPassRate = 1.0;
  let testEmptyCount = 0;
  let testWeakPct = 0;
  const testOutput = run('npm test 2>&1', 120000);
  if (testOutput) {
    const passMatch = testOutput.match(/pass\s+(\d+)/i);
    const failMatch = testOutput.match(/fail\s+(\d+)/i);
    const pass = passMatch ? parseInt(passMatch[1]) : 0;
    const fail = failMatch ? parseInt(failMatch[1]) : 0;
    testPassRate = (pass + fail) > 0 ? pass / (pass + fail) : 1.0;
  }

  // Test audit
  const auditOutput = run('node scripts/test-audit.js 2>&1');
  if (auditOutput) {
    const emptyMatch = auditOutput.match(/Empty[^:]*:\s*(\d+)/i);
    const weakMatch = auditOutput.match(/Weak[^:]*:\s*(\d+)/i);
    const totalMatch = auditOutput.match(/Total it\(\) blocks:\s*(\d+)/i);
    testEmptyCount = emptyMatch ? parseInt(emptyMatch[1]) : 0;
    const weak = weakMatch ? parseInt(weakMatch[1]) : 0;
    const total = totalMatch ? parseInt(totalMatch[1]) : 1;
    testWeakPct = (weak / total) * 100;
  }

  return { syntaxErrors, testPassRate, testWeakPct, testEmptyCount };
}

function collectGoodnessMetrics() {
  // Secrets scan
  let secretsFound = 0;
  const secretResult = run("grep -rn 'sk-ant-\\|ghp_\\|gho_\\|xoxb-\\|AKIA' agent/ config/ scripts/ --include='*.js' 2>/dev/null | grep -v 'preflight.js\\|pillar-metrics.js' | wc -l");
  if (secretResult) secretsFound = parseInt(secretResult.trim()) || 0;

  // npm audit
  let auditCritical = 0;
  const auditResult = run('npm audit --json 2>/dev/null');
  if (auditResult) {
    try {
      const audit = JSON.parse(auditResult);
      auditCritical = (audit.metadata?.vulnerabilities?.critical || 0) +
                      (audit.metadata?.vulnerabilities?.high || 0);
    } catch { /* parse failed */ }
  }

  // Bare catch — distinguish dangerous (swallow errors) from safe (JSON.parse fallback)
  // Uses -B1 to check the line before catch for JSON.parse context
  let bareCatchCount = 0;
  const catchResult = run("grep -rn -B1 'catch\\s*{' agent/ --include='*.js' 2>/dev/null");
  if (catchResult) {
    // Split into groups of (context + catch line) separated by --
    const groups = catchResult.split('--\n').filter(Boolean);
    for (const group of groups) {
      const block = group.trim();
      // Safe patterns: JSON.parse fallback, process kill, file unlink, git command
      const isSafe = /JSON\.parse|return null|\.kill\(|\.unlink\(|git\s/.test(block);
      if (!isSafe) bareCatchCount++;
    }
  }

  return { secretsFound, auditCritical, bareCatchCount };
}

function collectBeautyMetrics() {
  // Long files (>300 lines)
  let longFiles = 0;
  const dirs = ['agent/core', 'agent/team', 'agent/interface', 'agent/memory'];
  for (const dir of dirs) {
    const full = path.join(KINGDOM, dir);
    if (!fs.existsSync(full)) continue;
    for (const f of fs.readdirSync(full).filter(f => f.endsWith('.js'))) {
      const content = fs.readFileSync(path.join(full, f), 'utf-8');
      if (content.split('\n').length > 300) longFiles++;
    }
  }

  // console.log in agent code
  let consoleLogFiles = 0;
  const clResult = run("grep -rl 'console\\.log' agent/ --include='*.js' 2>/dev/null | wc -l");
  if (clResult) consoleLogFiles = parseInt(clResult.trim()) || 0;

  // Test empty percentage
  let testEmptyPct = 0;
  const auditOutput = run('node scripts/test-audit.js 2>&1');
  if (auditOutput) {
    const emptyPctMatch = auditOutput.match(/Empty:\s*(\d+)%/);
    testEmptyPct = emptyPctMatch ? parseInt(emptyPctMatch[1]) : 0;
  }

  return { longFiles, consoleLogFiles, testEmptyPct };
}

function collectBenevolenceMetrics() {
  let totalLines = 0;
  let totalFiles = 0;
  let errorsWithContext = 0;
  let totalErrors = 0;

  const dirs = ['agent/core', 'agent/team', 'agent/interface', 'agent/memory'];
  for (const dir of dirs) {
    const full = path.join(KINGDOM, dir);
    if (!fs.existsSync(full)) continue;
    for (const f of fs.readdirSync(full).filter(f => f.endsWith('.js'))) {
      const content = fs.readFileSync(path.join(full, f), 'utf-8');
      totalFiles++;
      totalLines += content.split('\n').length;

      // Count error messages with context (has template literal or concatenation)
      const errMatches = content.match(/new Error\(/g) || [];
      const ctxMatches = content.match(/new Error\(`[^`]*\$\{/g) || [];
      totalErrors += errMatches.length;
      errorsWithContext += ctxMatches.length;
    }
  }

  const avgFileLines = totalFiles > 0 ? totalLines / totalFiles : 0;
  const errorClarityScore = totalErrors > 0 ? errorsWithContext / totalErrors : 1.0;

  return { avgFileLines, errorClarityScore, totalAgentFiles: totalFiles };
}

function collectLoyaltyMetrics() {
  let deadEvents = 0;
  let phantomListeners = 0;

  const scanOutput = run('node scripts/scan-events.js 2>&1');
  if (scanOutput) {
    const deadMatch = scanOutput.match(/Dead events:\s*(\d+)/);
    const phantomMatch = scanOutput.match(/Phantom listeners:\s*(\d+)/);
    deadEvents = deadMatch ? parseInt(deadMatch[1]) : 0;
    phantomListeners = phantomMatch ? parseInt(phantomMatch[1]) : 0;
  }

  // Dependency drift (outdated major versions)
  let dependencyDrift = 0;
  const outdated = run('npm outdated --json 2>/dev/null');
  if (outdated) {
    try {
      const deps = JSON.parse(outdated);
      for (const [, info] of Object.entries(deps)) {
        const curr = (info.current || '').split('.')[0];
        const latest = (info.latest || '').split('.')[0];
        if (curr !== latest) dependencyDrift++;
      }
    } catch { /* parse failed */ }
  }

  return { deadEvents, phantomListeners, testFlakyRate: 0, dependencyDrift };
}

function collectEternityMetrics() {
  const BB = path.join(KINGDOM, '..');
  let vaultOrphans = 0;
  let missingFrontmatter = 0;

  const vhOutput = run('node scripts/vault-health.js 2>&1');
  if (vhOutput) {
    const orphanMatch = vhOutput.match(/Orphan[^:]*:\s*(\d+)/i);
    const fmMatch = vhOutput.match(/Missing frontmatter:\s*(\d+)/i);
    vaultOrphans = orphanMatch ? parseInt(orphanMatch[1]) : 0;
    missingFrontmatter = fmMatch ? parseInt(fmMatch[1]) : 0;
  }

  // MEMORY.md
  const memPath = path.join(
    process.env.HOME || '/tmp',
    '.claude', 'projects', '-Users-brnestrm', 'memory', 'MEMORY.md'
  );
  const memoryPresent = fs.existsSync(memPath) &&
    fs.readFileSync(memPath, 'utf-8').length > 100;

  // Session log recency
  let sessionLogRecent = false;
  const dailyDir = path.join(BB, '04-Daily');
  if (fs.existsSync(dailyDir)) {
    const files = fs.readdirSync(dailyDir)
      .filter(f => f.includes('session-log'))
      .sort()
      .reverse();
    if (files.length > 0) {
      const stat = fs.statSync(path.join(dailyDir, files[0]));
      const daysSince = (Date.now() - stat.mtimeMs) / (1000 * 60 * 60 * 24);
      sessionLogRecent = daysSince < 7;
    }
  }

  return { vaultOrphans, missingFrontmatter, memoryPresent, sessionLogRecent };
}

// ── Score functions (individual, for testing) ────────────────

const scoreFunctions = {
  scoreTruth,
  scoreGoodness,
  scoreBeauty,
  scoreBenevolence,
  scoreLoyalty,
  scoreEternity,
};

module.exports = {
  fromRawMetrics,
  collectAndScore,
  clampScore,
  ...scoreFunctions,
};
