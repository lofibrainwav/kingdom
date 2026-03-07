#!/usr/bin/env node
/**
 * dev-research.js — Quick research helper for development.
 * Queries Grok (if available) and searches codebase for prior art.
 *
 * Usage:
 *   node scripts/dev-research.js "topic or question"
 *   node scripts/dev-research.js --save "topic"   # save to bb/02-Research/
 *
 * Requires: GROK_MCP_URL env var for Grok queries
 */
const fs = require('fs');
const path = require('path');

const KINGDOM = path.join(__dirname, '..');
const BB = path.join(KINGDOM, '..');
const RESEARCH_DIR = path.join(BB, '02-Research');

const args = process.argv.slice(2);
const doSave = args.includes('--save');
const topic = args.filter(a => a !== '--save').join(' ');

if (!topic) {
  console.log('Usage: node scripts/dev-research.js "topic"');
  process.exit(1);
}

// ── 1. Codebase search ──
function searchCodebase(query) {
  const { execSync } = require('child_process');
  const results = [];

  // Search for relevant files
  try {
    const grep = execSync(
      `grep -rn "${query}" --include='*.js' --include='*.md' -l agent/ test/ scripts/ 2>/dev/null | head -10`,
      { cwd: KINGDOM, encoding: 'utf-8' }
    ).trim();
    if (grep) results.push(...grep.split('\n').map(f => `  ${f}`));
  } catch {}

  return results;
}

// ── 2. Vault search ──
function searchVault(query) {
  const results = [];
  const dirs = ['03-Skills', '05-Operations', '01-Projects/kingdom'];

  for (const dir of dirs) {
    const full = path.join(BB, dir);
    if (!fs.existsSync(full)) continue;
    try {
      const { execSync } = require('child_process');
      const grep = execSync(
        `grep -rn "${query}" --include='*.md' -l "${full}" 2>/dev/null | head -5`,
        { encoding: 'utf-8' }
      ).trim();
      if (grep) results.push(...grep.split('\n').map(f => `  ${f.replace(BB + '/', 'bb/')}`));
    } catch {}
  }

  return results;
}

// ── 3. Grok query ──
async function askGrok(question) {
  const url = process.env.GROK_MCP_URL;
  if (!url) return null;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: `For a Node.js agent system (Redis pub/sub, 18 agents, TDD): ${question}. Be concise, max 5 bullet points.`
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.answer || null;
  } catch {
    return null;
  }
}

// ── 4. Save to vault ──
function saveToVault(topic, content) {
  const date = new Date().toISOString().slice(0, 10);
  const slug = topic.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 50);
  const filePath = path.join(RESEARCH_DIR, `${date}-${slug}.md`);

  fs.mkdirSync(RESEARCH_DIR, { recursive: true });

  const md = `---
tags: [type/research, source/dev-research, status/active]
created: ${date}
topic: "${topic}"
---
# Research: ${topic}

${content}

## See Also
- [[kingdom/infrastructure]]
- [[debugging]]
`;

  fs.writeFileSync(filePath, md);
  console.log(`\nSaved: ${filePath.replace(BB + '/', 'bb/')}`);
}

// ── Main ──
async function main() {
  console.log(`\n🔍 Dev Research: "${topic}"\n`);

  // Parallel: codebase + vault search
  const codeResults = searchCodebase(topic.split(' ')[0]);
  const vaultResults = searchVault(topic.split(' ')[0]);

  if (codeResults.length > 0) {
    console.log('📁 Codebase matches:');
    codeResults.forEach(r => console.log(r));
  } else {
    console.log('📁 Codebase: no matches');
  }

  if (vaultResults.length > 0) {
    console.log('\n📓 Vault matches:');
    vaultResults.forEach(r => console.log(r));
  }

  // Grok query
  console.log('\n🤖 Querying Grok...');
  const grokAnswer = await askGrok(topic);

  let fullContent = '';

  if (grokAnswer) {
    console.log('\n' + grokAnswer);
    fullContent = grokAnswer;
  } else {
    console.log('  (Grok not available — set GROK_MCP_URL)');
  }

  if (codeResults.length > 0) {
    fullContent += '\n\n## Codebase References\n' + codeResults.join('\n');
  }
  if (vaultResults.length > 0) {
    fullContent += '\n\n## Vault References\n' + vaultResults.join('\n');
  }

  if (doSave && fullContent) {
    saveToVault(topic, fullContent);
  }

  console.log('\n✅ Research complete.');
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
