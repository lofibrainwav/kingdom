#!/usr/bin/env node
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

for (const file of agentFiles) {
  const src = fs.readFileSync(file, 'utf-8');
  const pubRe = /publish\(\s*['"]([^'"]+)['"]/g;
  const subRe = /subscribe\(\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = pubRe.exec(src)) !== null) publishes.add(m[1]);
  while ((m = subRe.exec(src)) !== null) subscribes.add(m[1]);
}

const dead = [...publishes].filter(p => subscribes.has(p) === false);
const phantom = [...subscribes].filter(s => publishes.has(s) === false);

console.log(`Published: ${publishes.size} | Subscribed: ${subscribes.size}`);
console.log(`Dead events: ${dead.length}${dead.length > 0 ? ' ' + JSON.stringify(dead) : ' OK'}`);
console.log(`Phantom listeners: ${phantom.length}${phantom.length > 0 ? ' ' + JSON.stringify(phantom) : ' OK'}`);
