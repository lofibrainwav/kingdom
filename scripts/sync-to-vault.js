#!/usr/bin/env node
/**
 * sync-to-vault.js — Syncs kingdom state to Obsidian vault.
 * Automatically writes infrastructure snapshot + session summary.
 *
 * Usage:
 *   node scripts/sync-to-vault.js              # full sync
 *   node scripts/sync-to-vault.js --quick      # skip test counting
 *   node scripts/sync-to-vault.js --infra      # infrastructure only
 *   node scripts/sync-to-vault.js --session    # session log only
 *   node scripts/sync-to-vault.js --review     # weekly review
 *
 * Writes to:
 *   bb/01-Projects/kingdom/infrastructure.md
 *   bb/04-Daily/YYYY-MM-DD-session-log.md (append)
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const KINGDOM = path.join(__dirname, '..');
const BB = path.join(KINGDOM, '..');
const VAULT_PROJECTS = path.join(BB, '01-Projects', 'kingdom');
const VAULT_DAILY = path.join(BB, '04-Daily');

const args = process.argv.slice(2);
const modeArgs = args.filter(a => a !== '--quick');
const doInfra = modeArgs.length === 0 || modeArgs.includes('--infra');
const doSession = modeArgs.length === 0 || modeArgs.includes('--session');
const doReview = modeArgs.includes('--review');

// --- Helpers ---

function run(cmd, cwd = KINGDOM) {
  try {
    return execSync(cmd, { cwd, encoding: 'utf-8', timeout: 30000 }).trim();
  } catch { return ''; }
}

function findJsFiles(dir) {
  let files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...findJsFiles(full));
    else if (entry.name.endsWith('.js')) files.push(full);
  }
  return files;
}

function countTests() {
  const output = run('node --test --test-force-exit --test-concurrency=1 test/*.test.js 2>&1 | tail -5');
  const match = output.match(/tests\s+(\d+)/);
  return match ? parseInt(match[1]) : '?';
}

function countAgents() {
  const teamFile = path.join(KINGDOM, 'agent', 'team.js');
  const src = fs.readFileSync(teamFile, 'utf-8');
  const matches = src.match(/\{\s*name:\s*'/g);
  return matches ? matches.length : '?';
}

function scanEvents() {
  const agentDir = path.join(KINGDOM, 'agent');
  const files = findJsFiles(agentDir);
  const pubs = new Set();
  const subs = new Set();
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf-8');
    const pubRe = /publish\(\s*['"]([^'"]+)['"]/g;
    const subRe = /(?:subscribe|_subscribeBroadcast|_subscribeTaskEvent|_subscribePromotionEvent)\(\s*['"]([^'"]+)['"]/g;
    let m;
    while ((m = pubRe.exec(src)) !== null) pubs.add(m[1]);
    while ((m = subRe.exec(src)) !== null) subs.add(m[1]);
  }
  const dead = [...pubs].filter(p => !subs.has(p));
  const phantom = [...subs].filter(s => !pubs.has(s));
  return { published: pubs.size, subscribed: subs.size, dead: dead.length, phantom: phantom.length };
}

function countAgentFiles() {
  const dirs = ['team', 'core', 'interface', 'memory'].map(d => path.join(KINGDOM, 'agent', d));
  let total = 0;
  for (const dir of dirs) {
    if (fs.existsSync(dir)) {
      total += fs.readdirSync(dir).filter(f => f.endsWith('.js')).length;
    }
  }
  return total;
}

function getLatestCommit() {
  return run('git log --oneline -1');
}

function getBranch() {
  return run('git rev-parse --abbrev-ref HEAD');
}

function getGitStatus() {
  const status = run('git status --porcelain');
  return status ? `${status.split('\n').length} changes` : 'clean';
}

// --- Infrastructure Sync ---

function syncInfra() {
  console.log('Scanning kingdom state...');

  const agents = countAgents();
  const events = scanEvents();
  const agentFiles = countAgentFiles();
  const commit = getLatestCommit();
  const branch = getBranch();
  const gitStatus = getGitStatus();

  // Test count: run only if no --quick flag
  let tests;
  if (args.includes('--quick')) {
    tests = '(skipped --quick)';
  } else {
    console.log('Running tests (use --quick to skip)...');
    tests = countTests();
  }

  const now = new Date().toISOString().split('T')[0];
  const content = `---
tags: [type/infrastructure, source/sync-to-vault, status/active]
related: ["[[kingdom/patterns]]", "[[metacognition]]"]
created: ${now}
author: sync-to-vault
---

# Kingdom Infrastructure — Auto-synced

> Last sync: ${now} by \`sync-to-vault.js\`

## Pipeline
\`\`\`
Task → PM → Architect → Decomposer → Coder → Reviewer (local qwen3-8b)
  | (intermediate)                    ^ vibePatches    | APPROVE        | REJECT
  RuminationEngine (digestion)        ^ skillSynergies TeamLead (진선미)  FailureAgent
    → GoTReasoner (synergy) ──────────+                  | storeWorthy       → retry
                                                       ResearchAgent
                                                       (Grok→NLM→refine)
                                                          |
                                  Dashboard <- health     VaultBridge → Obsidian
\`\`\`

## Stats
| Metric | Value |
|--------|-------|
| Tests | ${tests} |
| Agents (team.js) | ${agents} |
| Agent files | ${agentFiles} |
| Events published | ${events.published} |
| Events subscribed | ${events.subscribed} |
| Dead events | ${events.dead} |
| Phantom listeners | ${events.phantom} |
| Git branch | ${branch} |
| Latest commit | ${commit} |
| Working tree | ${gitStatus} |

## 3-Layer Knowledge Stack
| Layer | Tech | Role |
|-------|------|------|
| L3 (collect) | Grok MCP, Gmail MCP | Web search, latest info |
| L2 (refine) | NotebookLM MCP | KB store + RAG query |
| L1 (structure) | Obsidian Vault | 9 folders, structured md |

## DI Architecture
- Single \`sharedBoard\` (Blackboard) injected to all agents
- \`markShared()\` prevents agent-level disconnect
- \`forceDisconnect()\` used only by team.js at shutdown
- Idempotent \`connect()\`: \`if (this.client.isOpen) return\`
- \`DedupGuard\` for event idempotency

## Cost Model
| Component | Cost | Used By |
|-----------|------|---------|
| Ralph Team (qwen3-8b) | $0 | PM→Architect→Decomposer→Coder→Reviewer |
| TeamLead (Claude) | ~$0.01/batch | 진선미 + vibe translation |
| ResearchAgent (Grok+NLM) | $0 or API | Only when storeWorthy |
| Redis | $0 (local Docker) | All pub/sub + state |

## See Also
- [[kingdom/patterns]] — Codebase patterns and conventions
- [[metacognition]] — Session learnings and behavior principles
- [[debugging]] — Debugging lessons
`;

  fs.mkdirSync(VAULT_PROJECTS, { recursive: true });
  const infraPath = path.join(VAULT_PROJECTS, 'infrastructure.md');
  fs.writeFileSync(infraPath, content);
  console.log(`Wrote: ${infraPath}`);
}

// --- Session Log Sync ---

function syncSession() {
  const now = new Date();
  const date = now.toISOString().split('T')[0];
  const time = now.toTimeString().split(' ')[0];
  const commit = getLatestCommit();
  const gitStatus = getGitStatus();

  const entry = `
## ${time} — Auto-sync
- Commit: ${commit}
- Status: ${gitStatus}
`;

  fs.mkdirSync(VAULT_DAILY, { recursive: true });
  const logPath = path.join(VAULT_DAILY, `${date}-session-log.md`);

  if (fs.existsSync(logPath)) {
    fs.appendFileSync(logPath, entry);
  } else {
    const header = `---
tags: [type/session, source/sync-to-vault, status/active]
related: ["[[kingdom/infrastructure]]"]
created: ${date}
author: sync-to-vault
---

# Session Log — ${date}
`;
    fs.writeFileSync(logPath, header + entry);
  }
  console.log(`Appended: ${logPath}`);
}

// --- CLAUDE.md Stale Number Fix ---

function syncClaudeMd() {
  const claudePath = path.join(KINGDOM, 'CLAUDE.md');
  if (!fs.existsSync(claudePath)) return;

  let src = fs.readFileSync(claudePath, 'utf-8');
  const agents = countAgents();
  const agentFiles = countAgentFiles();

  // Count per directory
  const dirs = { core: 0, team: 0, interface: 0, memory: 0 };
  for (const [dir, key] of [['core', 'core'], ['team', 'team'], ['interface', 'interface'], ['memory', 'memory']]) {
    const d = path.join(KINGDOM, 'agent', dir);
    if (fs.existsSync(d)) dirs[key] = fs.readdirSync(d).filter(f => f.endsWith('.js')).length;
  }

  // Fix test count in phase status line
  // --quick: read cached count from .test-count; full: run tests and cache
  const countCachePath = path.join(KINGDOM, '.test-count');
  if (!args.includes('--quick')) {
    const tests = countTests();
    if (typeof tests === 'number') {
      src = src.replace(/\d+ tests green/, `${tests} tests green`);
      try { fs.writeFileSync(countCachePath, String(tests)); } catch {}
    }
  } else {
    // --quick: use cached test count if available
    try {
      const cached = parseInt(fs.readFileSync(countCachePath, 'utf-8').trim());
      if (cached > 0) {
        src = src.replace(/\d+ tests green/, `${cached} tests green`);
      }
    } catch {} // no cache yet — leave unchanged
  }

  // Fix agent file header
  src = src.replace(
    /### Agents \(\d+ files — \d+ team \+ \d+ core \+ \d+ interface \+ \d+ memory\)/,
    `### Agents (${agentFiles} files — ${dirs.team} team + ${dirs.core} core + ${dirs.interface} interface + ${dirs.memory} memory)`
  );

  // Fix codebase structure line
  src = src.replace(
    /Codebase structure: `agent\/core\/` \(\d+\), `agent\/team\/` \(\d+\), `agent\/interface\/` \(\d+\), `agent\/memory\/` \(\d+\) = \d+ files/,
    `Codebase structure: \`agent/core/\` (${dirs.core}), \`agent/team/\` (${dirs.team}), \`agent/interface/\` (${dirs.interface}), \`agent/memory/\` (${dirs.memory}) = ${agentFiles} files`
  );

  fs.writeFileSync(claudePath, src);
  console.log(`Updated: ${claudePath} (${agentFiles} files, ${agents} agents)`);
}

// --- Weekly Review Sync ---

function syncReview() {
  const now = new Date();
  const weekNum = getWeekNumber(now);
  const year = now.getFullYear();
  const label = `${year}-W${String(weekNum).padStart(2, '0')}`;

  console.log(`Generating weekly review: ${label}...`);

  // Scan past 7 days of session logs
  const logs = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    const logPath = path.join(VAULT_DAILY, `${dateStr}-session-log.md`);
    if (fs.existsSync(logPath)) {
      logs.push({ date: dateStr, content: fs.readFileSync(logPath, 'utf-8') });
    }
  }

  // Extract stats from logs
  const commitCount = logs.reduce((sum, log) => {
    const matches = log.content.match(/Commit:/g);
    return sum + (matches ? matches.length : 0);
  }, 0);

  const sessionDates = logs.map(l => l.date).reverse();

  // Get test count and git stats
  const tests = args.includes('--quick') ? '(skipped)' : countTests();
  const commit = getLatestCommit();

  const reviewPath = path.join(VAULT_DAILY, `weekly-review-${label}.md`);
  const content = `---
tags: [type/review, source/sync-to-vault, status/active]
related: ["[[kingdom/infrastructure]]", "[[metacognition]]"]
created: ${now.toISOString().split('T')[0]}
author: sync-to-vault
---

# Weekly Review — ${label}

## Summary
- **Sessions**: ${logs.length} days with session logs
- **Session dates**: ${sessionDates.join(', ') || 'none'}
- **Commits logged**: ${commitCount}
- **Current tests**: ${tests}
- **Latest commit**: ${commit}

## Session Logs
${logs.map(l => `- [[${l.date}-session-log]] (${l.date})`).join('\n') || '- No session logs found'}

## See Also
- [[kingdom/infrastructure]] — Current infrastructure state
- [[metacognition]] — Session learnings
`;

  fs.mkdirSync(VAULT_DAILY, { recursive: true });
  fs.writeFileSync(reviewPath, content);
  console.log(`Wrote: ${reviewPath}`);
}

function getWeekNumber(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
}

// --- Main ---

if (doReview) {
  syncReview();
} else {
  if (doInfra) syncInfra();
  if (doSession) syncSession();
  syncClaudeMd();
}

console.log('Vault sync complete.');
