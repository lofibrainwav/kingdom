#!/usr/bin/env node
/**
 * sync-to-vault.js — Syncs kingdom state to Obsidian vault.
 * Automatically writes infrastructure snapshot + session summary.
 *
 * Usage:
 *   node scripts/sync-to-vault.js              # full sync
 *   node scripts/sync-to-vault.js --infra      # infrastructure only
 *   node scripts/sync-to-vault.js --session     # session log only
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
  const content = `# Kingdom Infrastructure — Auto-synced

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
    fs.writeFileSync(logPath, `# Session Log — ${date}\n${entry}`);
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

// --- Main ---

if (doInfra) syncInfra();
if (doSession) syncSession();
syncClaudeMd();

console.log('Vault sync complete.');
