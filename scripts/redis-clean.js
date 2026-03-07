#!/usr/bin/env node
/**
 * Redis Clean — Remove test waste, preserve Zettelkasten knowledge.
 *
 * Usage:
 *   node scripts/redis-clean.js           # dry-run (show what would be deleted)
 *   node scripts/redis-clean.js --force   # actually delete
 *   node scripts/redis-clean.js --backup  # backup zettelkasten before clean
 */
const { createClient } = require('redis');
const fs = require('fs');
const path = require('path');

const REDIS_URL = process.env.BLACKBOARD_REDIS_URL || 'redis://localhost:6380';
const args = process.argv.slice(2);
const force = args.includes('--force');
const backup = args.includes('--backup');

// Keys to ALWAYS preserve (된장)
const PRESERVE_PATTERNS = [
  'kingdom:zettelkasten:notes',
  'kingdom:zettelkasten:links:*',
];

async function main() {
  const client = createClient({ url: REDIS_URL });
  await client.connect();

  // Build preserve set
  const preserve = new Set();
  for (const pattern of PRESERVE_PATTERNS) {
    if (pattern.includes('*')) {
      const keys = await client.keys(pattern);
      keys.forEach(k => preserve.add(k));
    } else {
      preserve.add(pattern);
    }
  }

  const allKeys = await client.keys('kingdom:*');
  const toDelete = allKeys.filter(k => !preserve.has(k));

  console.log(`\nRedis Clean — ${force ? 'LIVE' : 'DRY RUN'}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Total keys:    ${allKeys.length}`);
  console.log(`Preserving:    ${preserve.size} (zettelkasten)`);
  console.log(`To delete:     ${toDelete.length}`);

  if (toDelete.length === 0) {
    console.log(`\n✅ Nothing to clean — Redis is already tidy.`);
    await client.disconnect();
    return;
  }

  // Categorize waste
  const categories = {};
  for (const k of toDelete) {
    const prefix = k.replace(/:[^:]+$/, '').replace(/:\d+$/, '');
    categories[prefix] = (categories[prefix] || 0) + 1;
  }
  console.log(`\nWaste by category:`);
  Object.entries(categories).sort((a, b) => b[1] - a[1]).slice(0, 15).forEach(([k, v]) => {
    console.log(`  ${v.toString().padStart(6)} ${k}`);
  });

  if (backup || force) {
    // Backup zettelkasten
    const notes = await client.hGetAll('kingdom:zettelkasten:notes');
    const linkKeys = await client.keys('kingdom:zettelkasten:links:*');
    const links = {};
    for (const k of linkKeys) { links[k] = await client.get(k); }

    const backupPath = path.join(__dirname, '..', 'logs',
      `redis-zettelkasten-backup-${new Date().toISOString().slice(0, 10)}.json`);
    fs.mkdirSync(path.dirname(backupPath), { recursive: true });
    fs.writeFileSync(backupPath, JSON.stringify({
      notes, links,
      meta: { date: new Date().toISOString(), skillCount: Object.keys(notes).length, linkCount: linkKeys.length },
    }, null, 2));
    console.log(`\n💾 Backup: ${backupPath}`);
  }

  if (force) {
    for (let i = 0; i < toDelete.length; i += 1000) {
      await client.del(toDelete.slice(i, i + 1000));
    }
    const remaining = await client.dbSize();
    console.log(`\n🧹 Deleted ${toDelete.length} keys. Remaining: ${remaining}`);
  } else {
    console.log(`\nDry run — add --force to actually delete.`);
  }

  await client.disconnect();
}

main().catch(err => { console.error('Error:', err.message); process.exit(1); });
