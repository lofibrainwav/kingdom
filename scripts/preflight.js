#!/usr/bin/env node
/**
 * preflight.js — Pre-mission readiness check (야전교범 점검)
 *
 * Like a soldier inspecting every weapon before battle.
 * Checks ALL systems, tools, skills, and dependencies.
 * Reports confidence level — 90%+ means ready for deployment order.
 *
 * Usage:
 *   node scripts/preflight.js              # full inspection
 *   node scripts/preflight.js --quick      # skip slow checks (tests, Grok)
 *
 * Exit codes:
 *   0 = ready (90%+)
 *   1 = not ready (<90%)
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const KINGDOM = path.join(__dirname, '..');
const BB = path.join(KINGDOM, '..');
const args = process.argv.slice(2);
const quick = args.includes('--quick');

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const NC = '\x1b[0m';

const checks = [];
let totalWeight = 0;
let passedWeight = 0;

function run(cmd, timeout = 10000) {
  try {
    return execSync(cmd, { cwd: KINGDOM, encoding: 'utf-8', timeout, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch { return null; }
}

function check(name, weight, fn) {
  const start = Date.now();
  let result;
  try {
    result = fn();
  } catch (err) {
    result = { ok: false, detail: err.message };
  }
  const ms = Date.now() - start;
  const { ok, detail, warn } = result;
  totalWeight += weight;
  if (ok) passedWeight += weight;
  if (warn) passedWeight += weight * 0.5;
  const icon = ok ? `${GREEN}✓${NC}` : warn ? `${YELLOW}△${NC}` : `${RED}✗${NC}`;
  const label = ok ? `${GREEN}${name}${NC}` : warn ? `${YELLOW}${name}${NC}` : `${RED}${name}${NC}`;
  const timeStr = `${DIM}${ms}ms${NC}`;
  console.log(`  ${icon} ${label} ${DIM}— ${detail}${NC} ${timeStr}`);
  checks.push({ name, ok, warn: !!warn, detail, weight, ms });
}

// ════════════════════════════════════════════════════════════════
console.log(`\n${BOLD}═══ PREFLIGHT CHECK (야전교범 점검) ═══${NC}\n`);

// ── 1. INFRASTRUCTURE (기반 시설) ──────────────────────────────
console.log(`${CYAN}[1/6] Infrastructure (기반)${NC}`);

check('Node.js', 10, () => {
  const ver = run('node -v');
  return ver ? { ok: true, detail: ver } : { ok: false, detail: 'not found' };
});

check('npm dependencies', 8, () => {
  const hasModules = fs.existsSync(path.join(KINGDOM, 'node_modules'));
  if (!hasModules) return { ok: false, detail: 'node_modules missing — run npm install' };
  const lockAge = fs.statSync(path.join(KINGDOM, 'package-lock.json')).mtimeMs;
  const pkgAge = fs.statSync(path.join(KINGDOM, 'package.json')).mtimeMs;
  if (pkgAge > lockAge) return { warn: true, ok: false, detail: 'package.json newer than lock — run npm install' };
  return { ok: true, detail: 'installed' };
});

check('Redis :6380', 8, () => {
  const pong = run('redis-cli -p 6380 ping');
  return pong === 'PONG' ? { ok: true, detail: 'PONG' } : { ok: false, detail: 'not responding' };
});

check('.env file', 5, () => {
  const exists = fs.existsSync(path.join(KINGDOM, '.env'));
  return exists ? { ok: true, detail: 'present' } : { warn: true, ok: false, detail: 'missing' };
});

check('Docker', 3, () => {
  const ver = run('docker --version');
  return ver ? { ok: true, detail: ver.replace('Docker version ', '').split(',')[0] } : { warn: true, ok: false, detail: 'not available' };
});

// ── 2. CODEBASE INTEGRITY (코드 무결성) ────────────────────────
console.log(`\n${CYAN}[2/6] Codebase Integrity (코드)${NC}`);

check('Agent syntax', 10, () => {
  const dirs = ['agent/core', 'agent/team', 'agent/interface', 'agent/memory'];
  let errors = 0;
  let total = 0;
  for (const dir of dirs) {
    const full = path.join(KINGDOM, dir);
    if (!fs.existsSync(full)) continue;
    for (const f of fs.readdirSync(full).filter(f => f.endsWith('.js'))) {
      total++;
      const result = run(`node -c ${dir}/${f}`);
      if (result === null) errors++;
    }
  }
  return errors === 0
    ? { ok: true, detail: `${total} files clean` }
    : { ok: false, detail: `${errors}/${total} syntax errors` };
});

check('Git status', 5, () => {
  const branch = run('git rev-parse --abbrev-ref HEAD');
  const status = run('git status --porcelain');
  const dirty = status ? status.split('\n').length : 0;
  const commit = run('git log --oneline -1');
  const detail = `${branch} | ${commit} | ${dirty === 0 ? 'clean' : `${dirty} changes`}`;
  return { ok: true, detail };
});

if (!quick) {
  check('Test suite', 15, () => {
    const output = run('npm test 2>&1 | tail -10', 120000);
    if (!output) return { ok: false, detail: 'tests failed to run' };
    const passMatch = output.match(/pass\s+(\d+)/);
    const failMatch = output.match(/fail\s+(\d+)/);
    const pass = passMatch ? parseInt(passMatch[1]) : 0;
    const fail = failMatch ? parseInt(failMatch[1]) : 0;
    return fail === 0
      ? { ok: true, detail: `${pass} passed, 0 failed` }
      : { ok: false, detail: `${pass} passed, ${fail} FAILED` };
  });
} else {
  check('Test suite (skipped)', 15, () => ({ ok: true, warn: true, detail: '--quick mode' }));
}

check('Test audit', 5, () => {
  const output = run('node scripts/test-audit.js 2>&1');
  if (!output) return { warn: true, ok: false, detail: 'audit script missing' };
  const weakMatch = output.match(/weak[^:]*:\s*(\d+)/i);
  const emptyMatch = output.match(/empty[^:]*:\s*(\d+)/i);
  const weak = weakMatch ? parseInt(weakMatch[1]) : 0;
  const empty = emptyMatch ? parseInt(emptyMatch[1]) : 0;
  return (weak === 0 && empty === 0)
    ? { ok: true, detail: '0 weak, 0 empty' }
    : { ok: false, detail: `${weak} weak, ${empty} empty` };
});

check('Event integrity', 5, () => {
  const output = run('node scripts/scan-events.js 2>&1');
  if (!output) return { warn: true, ok: false, detail: 'scan script missing' };
  const phantomMatch = output.match(/phantom[^:]*:\s*(\d+)/i);
  const phantom = phantomMatch ? parseInt(phantomMatch[1]) : -1;
  return phantom === 0
    ? { ok: true, detail: '0 phantom listeners' }
    : phantom === -1
      ? { warn: true, ok: false, detail: 'could not parse' }
      : { ok: false, detail: `${phantom} phantom listeners` };
});

// ── 3. MCP TOOLS (무기고 점검) ─────────────────────────────────
console.log(`\n${CYAN}[3/6] MCP Tools (무기고)${NC}`);

check('Grok HTTP bridge', 4, () => {
  if (quick) return { ok: true, warn: true, detail: '--quick mode' };
  const result = run('curl -s -o /dev/null -w "%{http_code}" http://localhost:3100/health', 5000);
  return result === '200'
    ? { ok: true, detail: 'http://localhost:3100 responding' }
    : { warn: true, ok: false, detail: `status ${result || 'unreachable'}` };
});

check('Chrome CDP', 3, () => {
  const result = run('curl -s http://localhost:9222/json/version 2>/dev/null | head -1', 5000);
  return result && result.includes('{')
    ? { ok: true, detail: 'CDP port 9222 active' }
    : { warn: true, ok: false, detail: 'CDP not available' };
});

check('Obsidian REST', 3, () => {
  const token = process.env.OBSIDIAN_API_KEY;
  if (!token) return { warn: true, ok: false, detail: 'OBSIDIAN_API_KEY not set' };
  // Token passed via env to avoid leaking in shell history/logs
  const result = run('curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $OBSIDIAN_API_KEY" http://127.0.0.1:27124/', 5000);
  return result === '200'
    ? { ok: true, detail: 'http://127.0.0.1:27124 responding' }
    : { warn: true, ok: false, detail: `status ${result || 'unreachable'}` };
});

// ── 4. SKILLS & KNOWLEDGE (병기 및 지식) ───────────────────────
console.log(`\n${CYAN}[4/6] Skills & Knowledge (병기)${NC}`);

check('Skill files', 4, () => {
  const skillDir = path.join(KINGDOM, '.claude', 'skills');
  if (!fs.existsSync(skillDir)) return { ok: false, detail: 'skill dir missing' };
  const skills = fs.readdirSync(skillDir).filter(d =>
    fs.statSync(path.join(skillDir, d)).isDirectory()
  );
  return { ok: skills.length > 10, detail: `${skills.length} skills loaded` };
});

check('BMAD workflow', 3, () => {
  const wf = path.join(KINGDOM, '_bmad', 'bmm', 'workflows', 'bmad-quick-flow', 'quick-dev', 'workflow.md');
  return fs.existsSync(wf)
    ? { ok: true, detail: 'quick-dev workflow present' }
    : { ok: false, detail: 'workflow.md missing' };
});

check('Vault health', 4, () => {
  const output = run('node scripts/vault-health.js 2>&1');
  if (!output) return { warn: true, ok: false, detail: 'vault-health failed' };
  const orphanMatch = output.match(/Orphan[^:]*:\s*(\d+)/i);
  const fmMatch = output.match(/Missing frontmatter:\s*(\d+)/i);
  const orphans = orphanMatch ? parseInt(orphanMatch[1]) : -1;
  const fm = fmMatch ? parseInt(fmMatch[1]) : -1;
  return (orphans === 0 && fm === 0)
    ? { ok: true, detail: '0 orphans, 0 missing frontmatter' }
    : { warn: true, ok: false, detail: `${orphans} orphans, ${fm} missing frontmatter` };
});

check('MEMORY.md', 3, () => {
  const memPath = path.join(process.env.HOME, '.claude', 'projects', '-Users-brnestrm', 'memory', 'MEMORY.md');
  if (!fs.existsSync(memPath)) return { warn: true, ok: false, detail: 'not found' };
  const content = fs.readFileSync(memPath, 'utf-8');
  const lines = content.split('\n').length;
  return { ok: true, detail: `${lines} lines` };
});

check('Debugging knowledge', 2, () => {
  const dbg = path.join(BB, '03-Skills', 'debugging.md');
  return fs.existsSync(dbg)
    ? { ok: true, detail: 'bb/03-Skills/debugging.md present' }
    : { warn: true, ok: false, detail: 'missing' };
});

// ── 5. CLOCKWORK AUTOMATION (자동화 시계) ──────────────────────
console.log(`\n${CYAN}[5/6] Clockwork Automation (시계)${NC}`);

check('clockwork.sh', 3, () => {
  const cw = path.join(KINGDOM, 'scripts', 'clockwork.sh');
  return fs.existsSync(cw)
    ? { ok: true, detail: 'present' }
    : { ok: false, detail: 'missing' };
});

check('LaunchAgent plists', 2, () => {
  const plistDir = path.join(KINGDOM, 'scripts', 'launchd');
  if (!fs.existsSync(plistDir)) return { warn: true, ok: false, detail: 'launchd dir missing' };
  const plists = fs.readdirSync(plistDir).filter(f => f.endsWith('.plist'));
  return { ok: plists.length >= 3, detail: `${plists.length} plist files` };
});

check('vault-health --fix', 2, () => {
  const src = fs.readFileSync(path.join(KINGDOM, 'scripts', 'vault-health.js'), 'utf-8');
  return src.includes('--fix')
    ? { ok: true, detail: 'auto-fix mode available' }
    : { ok: false, detail: 'no --fix mode' };
});

check('auto-commit.sh', 2, () => {
  const ac = path.join(KINGDOM, 'scripts', 'auto-commit.sh');
  return fs.existsSync(ac)
    ? { ok: true, detail: 'present' }
    : { ok: false, detail: 'missing' };
});

// ── 6. SECURITY (보안 점검) ────────────────────────────────────
console.log(`\n${CYAN}[6/6] Security (보안)${NC}`);

check('.env not committed', 5, () => {
  const tracked = run('git ls-files .env');
  return !tracked
    ? { ok: true, detail: '.env is gitignored' }
    : { ok: false, detail: '.env is TRACKED — remove immediately' };
});

check('No secrets in code', 5, () => {
  const result = run("grep -rn 'sk-ant-\\|ghp_\\|gho_\\|xoxb-' agent/ config/ scripts/ --include='*.js' 2>/dev/null | grep -v 'preflight.js' | head -1");
  return !result
    ? { ok: true, detail: 'no hardcoded tokens found' }
    : { ok: false, detail: `found: ${result.slice(0, 80)}` };
});

// ════════════════════════════════════════════════════════════════
// REPORT
// ════════════════════════════════════════════════════════════════

if (totalWeight === 0) {
  console.log(`\n  ${RED}${BOLD}✗ NO CHECKS RAN — system error${NC}\n`);
  process.exit(1);
}
const confidence = Math.min(100, Math.round((passedWeight / totalWeight) * 100));
const failed = checks.filter(c => !c.ok && !c.warn);
const warned = checks.filter(c => c.warn);
const passed = checks.filter(c => c.ok);
const totalMs = checks.reduce((sum, c) => sum + c.ms, 0);

console.log(`\n${BOLD}═══ READINESS REPORT (출진 준비 보고) ═══${NC}\n`);

const bar = '█'.repeat(Math.round(confidence / 2)) + '░'.repeat(50 - Math.round(confidence / 2));
const color = confidence >= 90 ? GREEN : confidence >= 70 ? YELLOW : RED;
console.log(`  ${BOLD}Confidence: ${color}${confidence}%${NC} ${DIM}[${bar}]${NC}`);
console.log(`  ${GREEN}${passed.length} passed${NC} | ${YELLOW}${warned.length} warned${NC} | ${RED}${failed.length} failed${NC} | ${DIM}${totalMs}ms${NC}`);

if (failed.length > 0) {
  console.log(`\n  ${RED}${BOLD}CRITICAL FAILURES:${NC}`);
  for (const f of failed) {
    console.log(`    ${RED}✗ ${f.name}: ${f.detail}${NC}`);
  }
}

if (warned.length > 0) {
  console.log(`\n  ${YELLOW}WARNINGS (non-blocking):${NC}`);
  for (const w of warned) {
    console.log(`    ${YELLOW}△ ${w.name}: ${w.detail}${NC}`);
  }
}

console.log('');
if (confidence >= 90) {
  console.log(`  ${GREEN}${BOLD}▶ READY FOR DEPLOYMENT — 출진 가능${NC}`);
  console.log(`  ${DIM}Commander, 90%+ 확신으로 출진 준비 완료. 명령을 기다립니다.${NC}`);
} else if (confidence >= 70) {
  console.log(`  ${YELLOW}${BOLD}⚠ CONDITIONAL READY — 조건부 출진${NC}`);
  console.log(`  ${DIM}일부 장비 미비. 위 경고 사항 확인 후 판단해주세요.${NC}`);
} else {
  console.log(`  ${RED}${BOLD}✗ NOT READY — 출진 불가${NC}`);
  console.log(`  ${DIM}위 실패 항목 해결 필요. 무기 없이 전장에 나가지 마세요.${NC}`);
}
console.log('');

process.exit(confidence >= 90 ? 0 : 1);
