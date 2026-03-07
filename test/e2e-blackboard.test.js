/**
 * E2E Integration Test — Blackboard + Redis live connection.
 * Tests real Redis pub/sub, hash operations, and pipeline message routing.
 * Requires Redis on :6380.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { Blackboard } = require('../agent/core/blackboard');

// Skip entire suite if Redis is not available
let redisAvailable = false;
try {
  const { execSync } = require('child_process');
  const pong = execSync('redis-cli -p 6380 ping', { encoding: 'utf-8', timeout: 3000 }).trim();
  redisAvailable = pong === 'PONG';
} catch { /* Redis not available */ }

describe('E2E: Blackboard + Redis integration', { skip: !redisAvailable && 'Redis :6380 not available' }, () => {
  let board;
  let subBoard;
  const testPrefix = `test-e2e-${Date.now()}`;

  before(async () => {
    board = new Blackboard();
    subBoard = new Blackboard();
    await board.connect();
    await subBoard.connect();
  });

  after(async () => {
    // Cleanup test keys
    const keys = await board.client.keys(`kingdom:${testPrefix}:*`);
    if (keys.length > 0) await board.client.del(keys);
    await board.forceDisconnect();
    await subBoard.forceDisconnect();
  });

  // ── Connection ─────────────────────────────────────────────

  it('should connect to Redis :6380', () => {
    assert.equal(board.client.isOpen, true, 'board should be open');
    assert.equal(subBoard.client.isOpen, true, 'subBoard should be open');
  });

  it('should be idempotent on double connect', async () => {
    await board.connect(); // should not throw
    assert.equal(board.client.isOpen, true, 'board should remain open after double connect');
  });

  // ── Pub/Sub routing ────────────────────────────────────────

  it('should route pub/sub through pipeline channel', async () => {
    const sub = await subBoard.createSubscriber();
    const received = [];

    await sub.subscribe('work:intake', (msg) => {
      received.push(msg);
    });

    await board.publish('work:intake', {
      task: 'e2e-test-task',
      author: 'e2e-test',
    });

    // Wait for message delivery
    await new Promise(r => setTimeout(r, 200));

    assert.equal(received.length, 1);
    assert.equal(received[0].task, 'e2e-test-task');
    assert.equal(received[0].author, 'e2e-test');

    await sub.unsubscribe('work:intake');
    await sub.disconnect();
  });

  it('should deliver to multiple subscribers on same channel', async () => {
    const sub1 = await subBoard.createSubscriber();
    const sub2Board = new Blackboard();
    await sub2Board.connect();
    const sub2 = await sub2Board.createSubscriber();

    const received1 = [];
    const received2 = [];

    await sub1.subscribe('governance:review:requested', (msg) => received1.push(msg));
    await sub2.subscribe('governance:review:requested', (msg) => received2.push(msg));

    await board.publish('governance:review:requested', {
      projectId: 'P1', taskId: 'T1', file: 'test.js', content: 'code', author: 'test',
    });

    await new Promise(r => setTimeout(r, 200));

    assert.equal(received1.length, 1, 'sub1 should receive');
    assert.equal(received2.length, 1, 'sub2 should receive');

    await sub1.unsubscribe('governance:review:requested');
    await sub2.unsubscribe('governance:review:requested');
    await sub1.disconnect();
    await sub2.disconnect();
    await sub2Board.forceDisconnect();
  });

  it('should not receive messages after unsubscribe', async () => {
    const sub = await subBoard.createSubscriber();
    const received = [];

    await sub.subscribe('work:intake', (msg) => received.push(msg));
    await sub.unsubscribe('work:intake');

    await board.publish('work:intake', { task: 'test', author: 'test' });
    await new Promise(r => setTimeout(r, 200));

    assert.equal(received.length, 0, 'should not receive after unsubscribe');

    await sub.disconnect();
  });

  // ── Hash operations (shared state) ─────────────────────────

  it('should setHashField and getHashField', async () => {
    await board.setHashField(`${testPrefix}:state`, 'agent1', { status: 'active' });
    const result = await board.getHashField(`${testPrefix}:state`, 'agent1');
    assert.deepEqual(result, { status: 'active' });
  });

  it('should getHash for all fields', async () => {
    await board.setHashField(`${testPrefix}:multi`, 'a', { x: 1 });
    await board.setHashField(`${testPrefix}:multi`, 'b', { x: 2 });
    const all = await board.getHash(`${testPrefix}:multi`);
    assert.equal(Object.keys(all).length, 2);
  });

  // ── Event schema validation ────────────────────────────────

  it('should validate event payload with schema-required fields', async () => {
    const sub = await subBoard.createSubscriber();
    const received = [];

    await sub.subscribe('governance:task:completed', (msg) => received.push(msg));

    await board.publish('governance:task:completed', {
      taskId: 'T-e2e',
      projectId: 'P-e2e',
      author: 'e2e-test',
      verificationCount: 1,
    });

    await new Promise(r => setTimeout(r, 200));

    assert.equal(received.length, 1);
    assert.equal(received[0].author, 'e2e-test');
    assert.equal(received[0].taskId, 'T-e2e');
    assert.equal(received[0].verificationCount, 1);

    await sub.unsubscribe('governance:task:completed');
    await sub.disconnect();
  });

  it('should reject publish with missing required field', async () => {
    await assert.rejects(
      () => board.publish('governance:task:completed', {
        taskId: 'T-e2e',
        author: 'test',
        // missing: projectId, verificationCount
      }),
      /requires field/
    );
  });

  // ── Pipeline flow simulation ───────────────────────────────

  it('should simulate PM → Architect → Decomposer pipeline flow', async () => {
    const sub = await subBoard.createSubscriber();
    const stages = [];

    await sub.subscribe('work:planning:init', () => stages.push('init'));
    await sub.subscribe('work:planning:designed', () => stages.push('designed'));
    await sub.subscribe('work:planning:decomposed', () => stages.push('decomposed'));

    // Full schema-compliant payloads (author required by Blackboard._validate)
    await board.publish('work:planning:init', {
      projectId: 'P-e2e', goal: 'test goal', agentId: 'pm', author: 'pm',
    });
    await new Promise(r => setTimeout(r, 100));

    await board.publish('work:planning:designed', {
      projectId: 'P-e2e', goal: 'test goal', architecture: 'simple', author: 'architect',
    });
    await new Promise(r => setTimeout(r, 100));

    await board.publish('work:planning:decomposed', {
      projectId: 'P-e2e', goal: 'test goal', tasks: ['T1'], author: 'decomposer',
    });
    await new Promise(r => setTimeout(r, 100));

    // Verify all 3 stages arrived in order (may have extras from alias families)
    assert.equal(stages.includes('init'), true, 'should have init stage');
    assert.equal(stages.includes('designed'), true, 'should have designed stage');
    assert.equal(stages.includes('decomposed'), true, 'should have decomposed stage');
    assert.equal(stages.indexOf('init') < stages.indexOf('designed'), true, 'init before designed');
    assert.equal(stages.indexOf('designed') < stages.indexOf('decomposed'), true, 'designed before decomposed');

    await sub.unsubscribe('work:planning:init');
    await sub.unsubscribe('work:planning:designed');
    await sub.unsubscribe('work:planning:decomposed');
    await sub.disconnect();
  });

  // ── markShared / disconnect safety ─────────────────────────

  it('should prevent disconnect on shared board', async () => {
    const shared = new Blackboard();
    await shared.connect();
    shared.markShared();

    // disconnect should be a no-op when shared
    await shared.disconnect();
    assert.equal(shared.client.isOpen, true, 'shared board should still be connected');

    // forceDisconnect should actually disconnect
    await shared.forceDisconnect();
    assert.equal(shared.client.isOpen, false, 'forceDisconnect should close connection');
  });

  // ── Agent status tracking ──────────────────────────────────

  it('should track agent status via updateStatus pattern', async () => {
    await board.setHashField(`${testPrefix}:agents`, 'pm-agent', {
      state: 'idle',
      task: 'waiting',
      ts: Date.now(),
    });

    await board.setHashField(`${testPrefix}:agents`, 'pm-agent', {
      state: 'working',
      task: 'processing T-1',
      ts: Date.now(),
    });

    const status = await board.getHashField(`${testPrefix}:agents`, 'pm-agent');
    assert.equal(status.state, 'working');
    assert.ok(status.task.includes('T-1'));
  });
});
