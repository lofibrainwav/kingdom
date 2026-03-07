#!/usr/bin/env node
/**
 * Quality Check — one-shot codebase health audit
 */
const fs = require('fs');
const path = require('path');

// ── 1. Secrets Scan ──────────────────────────────────
const secretPatterns = [
  /ANTHROPIC_API_KEY\s*=\s*['"](?:sk-|ant-)/,
  /password\s*[:=]\s*['"][^'"]{8,}/,
];
const scanDirs = ['agent', 'scripts', 'test', 'config'];
const secretHits = [];

function scanSecrets(dir) {
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const fp = path.join(dir, f.name);
    if (f.isDirectory() && !f.name.includes('node_modules')) scanSecrets(fp);
    else if (f.name.endsWith('.js')) {
      const content = fs.readFileSync(fp, 'utf-8');
      for (const p of secretPatterns) {
        if (p.test(content)) secretHits.push(fp);
      }
    }
  }
}
scanDirs.forEach(scanSecrets);

console.log('=== SECRETS SCAN ===');
console.log(secretHits.length === 0 ? '✅ Clean — no hardcoded secrets' : '⚠️ ' + secretHits.join('\n'));

// ── 2. Event Map Audit ───────────────────────────────
const pubRe = /publish\(\s*['`]([^'`]+)/g;
const subRe = /(?:subscribe|_subscribeBroadcast|_subscribePromotionEvent)\(\s*['`]([^'`]+)/g;
const published = new Set();
const subscribed = new Set();

function scanEvents(dir) {
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const fp = path.join(dir, f.name);
    if (f.isDirectory()) scanEvents(fp);
    else if (f.name.endsWith('.js') && !fp.includes('node_modules') && !fp.includes('test/')) {
      const c = fs.readFileSync(fp, 'utf-8');
      for (const m of c.matchAll(pubRe)) published.add(m[1]);
      for (const m of c.matchAll(subRe)) subscribed.add(m[1]);
    }
  }
}
scanEvents('agent');
scanEvents('scripts');

const dead = [...published].filter(e => !subscribed.has(e));
const phantom = [...subscribed].filter(e => !published.has(e));

console.log('\n=== EVENT MAP ===');
console.log(`Published: ${published.size} | Subscribed: ${subscribed.size}`);
console.log(`Dead (pub, no sub): ${dead.length}${dead.length ? ' → ' + dead.join(', ') : ''}`);
console.log(`Phantom (sub, no pub): ${phantom.length}${phantom.length ? ' → ' + phantom.join(', ') : ''}`);

// ── 3. File Count & Structure ────────────────────────
const agentDirs = { 'agent/core': 0, 'agent/team': 0, 'agent/memory': 0, 'agent/interface': 0 };
for (const dir of Object.keys(agentDirs)) {
  if (fs.existsSync(dir)) {
    agentDirs[dir] = fs.readdirSync(dir).filter(f => f.endsWith('.js')).length;
  }
}
const totalAgentFiles = Object.values(agentDirs).reduce((a, b) => a + b, 0);
const testFiles = fs.existsSync('test') ? fs.readdirSync('test').filter(f => f.endsWith('.test.js')).length : 0;

console.log('\n=== STRUCTURE ===');
for (const [dir, count] of Object.entries(agentDirs)) {
  console.log(`  ${dir}: ${count} files`);
}
console.log(`  Total agent files: ${totalAgentFiles}`);
console.log(`  Test files: ${testFiles}`);

// ── 4. DI Check — hardcoded "new Blackboard()" in team agents ─
const diViolations = [];
const teamDir = 'agent/team';
if (fs.existsSync(teamDir)) {
  for (const f of fs.readdirSync(teamDir).filter(f => f.endsWith('.js'))) {
    const content = fs.readFileSync(path.join(teamDir, f), 'utf-8');
    // Look for "new Blackboard()" NOT inside options fallback (options.board || new Blackboard())
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('new Blackboard()') && !lines[i].includes('options.board')) {
        diViolations.push(`${teamDir}/${f}:${i + 1}`);
      }
    }
  }
}

console.log('\n=== DI CHECK ===');
console.log(diViolations.length === 0
  ? '✅ No hardcoded Blackboard() in team agents'
  : '⚠️ DI violations:\n  ' + diViolations.join('\n  '));

// ── 5. Test Coverage Ratio ───────────────────────────
const testedModules = new Set();
if (fs.existsSync('test')) {
  for (const f of fs.readdirSync('test').filter(f => f.endsWith('.test.js'))) {
    const content = fs.readFileSync(path.join('test', f), 'utf-8');
    const requires = content.matchAll(/require\(['"]\.\.\/agent\/([^'"]+)/g);
    for (const m of requires) {
      // Normalize: add .js if missing
      const mod = m[1].endsWith('.js') ? m[1] : m[1] + '.js';
      testedModules.add(mod);
    }
  }
}

const allAgentModules = [];
for (const dir of Object.keys(agentDirs)) {
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.js'))) {
    allAgentModules.push(dir.replace('agent/', '') + '/' + f);
  }
}

const untested = allAgentModules.filter(m => !testedModules.has(m));
const coverageRatio = ((allAgentModules.length - untested.length) / allAgentModules.length * 100).toFixed(0);

console.log('\n=== TEST COVERAGE (import-based) ===');
console.log(`${allAgentModules.length - untested.length}/${allAgentModules.length} modules imported by tests (${coverageRatio}%)`);
if (untested.length > 0 && untested.length <= 10) {
  console.log('Untested: ' + untested.join(', '));
}

// ── Summary ──────────────────────────────────────────
console.log('\n=== SUMMARY ===');
const issues = secretHits.length + dead.length + phantom.length + diViolations.length;
if (issues === 0) {
  console.log('✅ All checks passed');
} else {
  console.log(`⚠️ ${issues} issue(s) found`);
}
