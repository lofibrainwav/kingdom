#!/usr/bin/env node
/**
 * scan-events.js — Static analysis of Redis pub/sub channels.
 * Finds dead events (published but nobody subscribes) and
 * phantom listeners (subscribed but nobody publishes).
 *
 * Scanning strategy:
 *   1. Direct: publish('channel'), subscribe('channel')
 *   2. Array-based: const channels = ['a','b']; for (ch of channels) subscribe(ch)
 *   3. Pattern: pSubscribe('agent:*') matches agent:* publishes
 */
const fs = require('fs');
const path = require('path');

const agentDir = path.join(__dirname, '..', 'agent');

function findInDir(dir) {
  let files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...findInDir(full));
    else if (entry.name.endsWith('.js')) files.push(full);
  }
  return files;
}

const agentFiles = findInDir(agentDir);
const publishes = new Set();
const subscribes = new Set();
const pSubscribePatterns = []; // glob patterns from pSubscribe

for (const file of agentFiles) {
  const src = fs.readFileSync(file, 'utf-8');

  // Direct publish
  const pubRe = /publish\(\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = pubRe.exec(src)) !== null) publishes.add(m[1]);

  // Direct subscribe
  const subRe = /(?:\.subscribe|_subscribeBroadcast|_subscribeTaskEvent|_subscribePromotionEvent)\(\s*['"]([^'"]+)['"]/g;
  while ((m = subRe.exec(src)) !== null) subscribes.add(m[1]);

  // Pattern subscribe (pSubscribe) — record as glob
  const pSubRe = /\.pSubscribe\(\s*['"]([^'"]+)['"]/g;
  while ((m = pSubRe.exec(src)) !== null) pSubscribePatterns.push(m[1]);

  // Array-based channels: look for arrays of colon-separated strings
  // near subscribe/pSubscribe loops (common pattern in dashboard, vault-bridge)
  const hasSubscribeLoop = /for\s*\([^)]*(?:Channel|ch)\b/.test(src) &&
    /\.(?:subscribe|pSubscribe)\s*\(/.test(src);
  if (hasSubscribeLoop) {
    const channelArrayRe = /\[\s*((?:'[^']+'\s*,?\s*)+)\]/g;
    while ((m = channelArrayRe.exec(src)) !== null) {
      const items = m[1].match(/'([^']+)'/g);
      if (items) {
        for (const item of items) {
          const ch = item.replace(/'/g, '');
          if (ch.includes(':')) subscribes.add(ch);
        }
      }
    }
  }
}

// Match pSubscribe patterns against publishes (e.g., 'agent:*' covers 'agent:pm:status')
function matchesGlob(pattern, channel) {
  const re = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
  return re.test(channel);
}

// A published event is "alive" if any subscriber or pSubscribe pattern matches
const dead = [...publishes].filter(p => {
  if (subscribes.has(p)) return false;
  return !pSubscribePatterns.some(pat => matchesGlob(pat, p));
});

// A subscribe is "phantom" if nobody publishes it (and it's not a glob pattern)
const phantom = [...subscribes].filter(s => {
  if (publishes.has(s)) return false;
  // Check if any publish could match this as a pattern
  return !s.includes('*');
});

console.log(`Published: ${publishes.size} | Subscribed: ${subscribes.size} | pSubscribe patterns: ${pSubscribePatterns.length}`);
console.log(`Dead events: ${dead.length}${dead.length > 0 ? ' ' + JSON.stringify(dead) : ' OK'}`);
console.log(`Phantom listeners: ${phantom.length}${phantom.length > 0 ? ' ' + JSON.stringify(phantom) : ' OK'}`);

if (dead.length > 0 || phantom.length > 0) {
  process.exit(0); // informational, not a failure
}
