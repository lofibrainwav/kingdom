/**
 * Pipeline Integration Test — verifies real Redis Pub/Sub message flow
 * Requires Redis on BLACKBOARD_REDIS_URL (default: redis://localhost:6380)
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { Blackboard } = require('../agent/core/blackboard');

describe('Pipeline Integration — Real Redis Pub/Sub', () => {
  let pubBoard;
  let subBoard;
  let subscriber;

  before(async () => {
    pubBoard = new Blackboard();
    subBoard = new Blackboard();
    await pubBoard.connect();
    await subBoard.connect();
    subscriber = await subBoard.createSubscriber();
  });

  after(async () => {
    await subscriber.disconnect();
    await subBoard.disconnect();
    await pubBoard.disconnect();
  });

  it('message flows from work:intake to subscriber', async () => {
    const received = [];

    await subscriber.subscribe('work:intake', (msg) => {
      received.push(typeof msg === 'string' ? JSON.parse(msg) : msg);
    });

    await new Promise(r => setTimeout(r, 50));

    await pubBoard.publish('work:intake', {
      task: 'integration-test-task',
      author: 'test-runner',
    });

    await new Promise(r => setTimeout(r, 100));

    assert.ok(received.length >= 1, 'should receive at least 1 message');
    const msg = received.find(m => m.task === 'integration-test-task');
    assert.ok(msg, 'should find our test message');
    assert.equal(msg.author, 'test-runner');
  });

  it('message flows through work:planning:init channel', async () => {
    const received = [];

    await subscriber.subscribe('work:planning:init', (msg) => {
      received.push(typeof msg === 'string' ? JSON.parse(msg) : msg);
    });

    await new Promise(r => setTimeout(r, 50));

    await pubBoard.publish('work:planning:init', {
      projectId: 'test-project',
      goal: 'test goal',
      agentId: 'Kingdom_PM',
      author: 'test-runner',
    });

    await new Promise(r => setTimeout(r, 100));

    assert.ok(received.length >= 1);
    const msg = received.find(m => m.projectId === 'test-project');
    assert.ok(msg);
  });

  it('governance:review:requested channel delivers payload', async () => {
    const received = [];

    await subscriber.subscribe('governance:review:requested', (msg) => {
      received.push(typeof msg === 'string' ? JSON.parse(msg) : msg);
    });

    await new Promise(r => setTimeout(r, 50));

    await pubBoard.publish('governance:review:requested', {
      projectId: 'proj-1',
      taskId: 'task-1',
      file: 'test.js',
      content: 'const x = 1;',
      author: 'test-runner',
    });

    await new Promise(r => setTimeout(r, 100));

    assert.ok(received.length >= 1);
    const msg = received.find(m => m.file === 'test.js');
    assert.ok(msg);
  });

  it('setConfig and getConfig round-trip through Redis', async () => {
    await pubBoard.setConfig('test:integration', { key: 'value' });
    const config = await pubBoard.getConfig('test:integration');
    assert.equal(config.key, 'value');

    // Cleanup
    await pubBoard.client.del('kingdom:config:test:integration');
  });

  it('legacy alias publish reaches canonical subscriber', async () => {
    const received = [];

    // Subscribe to canonical channel
    const sub2 = await subBoard.createSubscriber();
    await sub2.subscribe('work:intake', (msg) => {
      received.push(typeof msg === 'string' ? JSON.parse(msg) : msg);
    });

    await new Promise(r => setTimeout(r, 50));

    // Publish via legacy alias
    await pubBoard.publish('commands:assign', {
      task: 'alias-test',
      author: 'test-alias',
    });

    await new Promise(r => setTimeout(r, 100));

    const msg = received.find(m => m.task === 'alias-test');
    assert.ok(msg, 'alias should resolve and deliver to canonical subscriber');

    await sub2.disconnect();
  });
});
