#!/usr/bin/env node
/**
 * Repo Structure Scanner — prevents nested git repo confusion.
 * Reports: git root, remote, branch, latest commit for bb/ and kingdom/.
 */
const { execSync } = require('child_process');
const path = require('path');

const KINGDOM = path.join(__dirname, '..');
const BB = path.join(KINGDOM, '..');

function gitInfo(dir, label) {
  const run = (cmd) => {
    try {
      return execSync(cmd, { cwd: dir, encoding: 'utf-8' }).trim();
    } catch { return '(error)'; }
  };

  const root = run('git rev-parse --show-toplevel');
  const remote = run('git remote get-url origin 2>/dev/null') || '(no remote)';
  const branch = run('git rev-parse --abbrev-ref HEAD');
  const commit = run('git log --oneline -1');
  const status = run('git status --porcelain');
  const dirty = status ? `${status.split('\n').length} changes` : 'clean';

  console.log(`\n[${label}]`);
  console.log(`  root:   ${root}`);
  console.log(`  remote: ${remote}`);
  console.log(`  branch: ${branch}`);
  console.log(`  commit: ${commit}`);
  console.log(`  status: ${dirty}`);

  return { root, remote, branch, commit, dirty };
}

const bb = gitInfo(BB, 'bb/');
const kingdom = gitInfo(KINGDOM, 'bb/kingdom/');

// Sanity checks
let errors = 0;

if (bb.root === kingdom.root) {
  console.log('\n❌ ERROR: bb/ and kingdom/ share the same git root — nested repo broken');
  errors++;
}

if (kingdom.remote.includes('(no remote)')) {
  console.log('\n❌ ERROR: kingdom/ has no git remote');
  errors++;
}

if (bb.remote.includes('kingdom')) {
  console.log('\n⚠️  WARNING: bb/ remote points to kingdom repo — check if intentional');
}

if (errors === 0) {
  console.log('\n✅ Repo structure OK — two independent nested repos');
}
