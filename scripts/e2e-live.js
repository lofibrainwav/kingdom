#!/usr/bin/env node
/**
 * Kingdom E2E Live Test — boots agents, sends task, observes pipeline, shuts down.
 * No separate `npm start` needed.
 *
 * Usage: node --env-file=.env scripts/e2e-live.js
 */
const { Blackboard } = require('../agent/core/blackboard');
const { getLogger } = require('../agent/core/logger');
const { PMAgent } = require('../agent/team/pm-agent');
const { ArchitectAgent } = require('../agent/team/architect');
const { DecomposerAgent } = require('../agent/team/decomposer');
const { CoderAgent } = require('../agent/team/coder');
const { ReviewerAgent } = require('../agent/team/reviewer');
const log = getLogger();

const TASK = process.argv[2] || 'Create a hello-world utility that exports a greet(name) function';
const OBSERVE_MS = 45_000;

const PIPELINE_CHANNELS = [
  { ch: 'work:planning:init',          label: 'PM -> Architect' },
  { ch: 'work:planning:designed',      label: 'Architect -> Decomposer' },
  { ch: 'work:planning:decomposed',    label: 'Decomposer -> Coder' },
  { ch: 'governance:review:requested', label: 'Coder -> Reviewer' },
  { ch: 'governance:review:approved',  label: 'Reviewer APPROVED' },
  { ch: 'governance:review:rejected',  label: 'Reviewer REJECTED' },
  { ch: 'execution:swarm:spawn',       label: 'Swarm spawn' },
];

async function main() {
  console.log('\n=== Kingdom E2E Live Test ===');
  console.log(`Task: ${TASK}`);
  console.log(`Observe: ${OBSERVE_MS / 1000}s\n`);

  // 1. Boot core pipeline agents (PM -> Architect -> Decomposer -> Coder -> Reviewer)
  const agents = [
    { name: 'PM', instance: new PMAgent() },
    { name: 'Architect', instance: new ArchitectAgent() },
    { name: 'Decomposer', instance: new DecomposerAgent() },
    { name: 'Coder', instance: new CoderAgent() },
    { name: 'Reviewer', instance: new ReviewerAgent() },
  ];

  console.log('[BOOT] Initializing 5 pipeline agents...');
  for (const a of agents) {
    try {
      await a.instance.init();
      console.log(`  [OK] ${a.name}`);
    } catch (err) {
      console.log(`  [FAIL] ${a.name}: ${err.message}`);
    }
  }

  // 2. Set up observer
  const observer = new Blackboard();
  await observer.connect();
  const sub = await observer.createSubscriber();
  sub.on('error', () => {});

  const received = [];
  const startTime = Date.now();

  for (const { ch, label } of PIPELINE_CHANNELS) {
    await sub.subscribe(ch, (msg) => {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const data = typeof msg === 'string' ? (() => { try { return JSON.parse(msg); } catch { return msg; } })() : msg;
      const preview = JSON.stringify(data).slice(0, 100);
      console.log(`\n  [+${elapsed}s] ${label}`);
      console.log(`    ${preview}...`);
      received.push({ ch, elapsed, label });
    });
  }

  // 3. Send task to PM
  console.log('\n[SEND] Publishing task to work:intake...\n');
  await observer.publish('work:intake', {
    task: TASK,
    author: 'e2e-live',
  });

  // 4. Wait and observe
  await new Promise(resolve => setTimeout(resolve, OBSERVE_MS));

  // 5. Summary
  console.log('\n=== Results ===');
  if (received.length === 0) {
    console.log('No pipeline events received.');
    console.log('Possible issues:');
    console.log('  - PM not subscribed to work:intake');
    console.log('  - LLM call failed (check LM Studio)');
    console.log('  - Agent init error');
  } else {
    console.log(`${received.length} pipeline steps completed:`);
    received.forEach(r => console.log(`  [+${r.elapsed}s] ${r.label}`));
  }

  // 6. Shutdown
  console.log('\n[SHUTDOWN] Stopping agents...');
  await sub.disconnect();
  await observer.disconnect();
  for (const a of [...agents].reverse()) {
    try { await a.instance.shutdown(); } catch {}
  }
  console.log('[DONE]\n');
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
