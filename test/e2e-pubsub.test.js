/**
 * E2E Pub/Sub Flow Test — verifies real event propagation through Blackboard.
 * Requires Redis on localhost:6380 (Docker).
 */
const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const { createClient } = require('redis');
const { Blackboard } = require('../agent/core/blackboard');

const REDIS_URL = process.env.BLACKBOARD_REDIS_URL || 'redis://localhost:6380';

async function isRedisAvailable() {
  const client = createClient({ url: REDIS_URL });
  try {
    await client.connect();
    await client.ping();
    await client.disconnect();
    return true;
  } catch {
    return false;
  }
}

describe('E2E Pub/Sub — real event propagation', async () => {
  const available = await isRedisAvailable();
  if (!available) {
    it('SKIP: Redis not available', { skip: 'Redis not reachable' }, () => {
      assert.ok(true, 'skipped — Redis not available');
    });
    return;
  }

  let pub;
  let sub;
  let subscriber;

  after(async () => {
    if (subscriber) await subscriber.disconnect();
    if (sub) await sub.disconnect();
    if (pub) await pub.disconnect();
  });

  it('publish → subscribe delivers message with correct payload', async () => {
    pub = new Blackboard();
    sub = new Blackboard();
    await pub.connect();
    await sub.connect();
    subscriber = await sub.createSubscriber();

    const received = [];
    await subscriber.subscribe('governance:review:requested', (msg) => {
      received.push(typeof msg === 'string' ? JSON.parse(msg) : msg);
    });

    // Small delay for subscription to be ready
    await new Promise(r => setTimeout(r, 50));

    await pub.publish('governance:review:requested', {
      projectId: 'e2e-test',
      taskId: 'T1',
      file: 'test.js',
      content: 'console.log("hello")',
      author: 'e2e-test',
    });

    await new Promise(r => setTimeout(r, 100));
    assert.equal(received.length, 1);
    assert.equal(received[0].projectId, 'e2e-test');
    assert.equal(received[0].taskId, 'T1');
  });

  it('schema validation rejects invalid payloads at publish time', async () => {
    const board = new Blackboard();
    await board.connect();

    await assert.rejects(
      () => board.publish('governance:review:requested', {
        projectId: 'e2e-test',
        // missing required: taskId, file, content (+ author)
      }),
      /author field is required|requires field/
    );

    await board.disconnect();
  });

  it('pattern subscribe (pSubscribe) receives matching events', async () => {
    const board = new Blackboard();
    await board.connect();
    const patternSub = await board.createSubscriber();

    const received = [];
    await patternSub.pSubscribe('knowledge:reflexion:*', (msg, channel) => {
      received.push({ channel, data: typeof msg === 'string' ? JSON.parse(msg) : msg });
    });

    await new Promise(r => setTimeout(r, 50));

    await pub.publish('knowledge:reflexion:triggered', { author: 'e2e-test' });
    await new Promise(r => setTimeout(r, 100));

    assert.equal(received.length, 1);
    assert.equal(received[0].channel, 'knowledge:reflexion:triggered');

    await patternSub.disconnect();
    await board.disconnect();
  });
});
