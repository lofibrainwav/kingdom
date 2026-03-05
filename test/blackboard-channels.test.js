const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { Blackboard } = require('../agent/core/blackboard');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe('Blackboard Channel Compatibility', () => {
  let board;

  before(async () => {
    board = new Blackboard();
    await board.connect();
    const keys = await board.client.keys('octiv:work:*');
    const legacyKeys = await board.client.keys('octiv:commands:*');
    const execKeys = await board.client.keys('octiv:execution:*');
    const commandKeys = await board.client.keys('octiv:command:*');
    const all = [...keys, ...legacyKeys, ...execKeys, ...commandKeys];
    if (all.length > 0) {
      await board.client.del(all);
    }
  });

  after(async () => {
    const keys = await board.client.keys('octiv:work:*');
    const legacyKeys = await board.client.keys('octiv:commands:*');
    const execKeys = await board.client.keys('octiv:execution:*');
    const commandKeys = await board.client.keys('octiv:command:*');
    const all = [...keys, ...legacyKeys, ...execKeys, ...commandKeys];
    if (all.length > 0) {
      await board.client.del(all);
    }
    await board.disconnect();
  });

  it('publishing a canonical work channel should remain readable through its legacy alias', async () => {
    await board.publish('work:intake', {
      author: 'channel-test',
      task: 'build memory loop'
    });

    const canonical = await board.get('work:intake');
    const legacy = await board.get('commands:assign');

    assert.equal(canonical.task, 'build memory loop');
    assert.equal(legacy.task, 'build memory loop');
  });

  it('publishing a legacy work channel should update the canonical channel view', async () => {
    await board.publish('commands:assign', {
      author: 'channel-test',
      task: 'migrate to canonical channels'
    });

    const canonical = await board.get('work:intake');
    const legacy = await board.get('commands:assign');

    assert.equal(canonical.task, 'migrate to canonical channels');
    assert.equal(legacy.task, 'migrate to canonical channels');
  });


  it('publishing legacy governance and knowledge channels should update canonical views', async () => {
    await board.publish('reviewer:task_approved', {
      author: 'channel-test',
      projectId: 'proj-1',
      taskId: 'task-1',
      file: 'task_1.js'
    });
    await board.publish('skills:emergency', {
      author: 'channel-test',
      newSkill: 'pattern-memory'
    });

    const approval = await board.get('governance:review:approved');
    const skill = await board.get('knowledge:skills:deployed');

    assert.equal(approval.projectId, 'proj-1');
    assert.equal(skill.newSkill, 'pattern-memory');
  });


  it('pattern subscribers should receive parsed payloads with normalized channel names', async () => {
    const subscriber = await board.createSubscriber();
    let received = null;

    await subscriber.pSubscribe('agent:*:chat', (message, channel) => {
      received = { message, channel };
    });

    await board.publish('agent:test-agent:chat', {
      author: 'channel-test',
      text: 'shared context'
    });

    await sleep(100);

    assert.ok(received);
    assert.equal(received.channel, 'agent:test-agent:chat');
    assert.equal(received.message.text, 'shared context');

    await subscriber.pUnsubscribe('agent:*:chat');
    await subscriber.disconnect();
  });


  it('publishing legacy review and reasoning channels should update canonical views', async () => {
    await board.publish('coder:task_complete', {
      author: 'channel-test',
      projectId: 'proj-2',
      taskId: 'task-2',
      file: 'task_2.js',
      content: 'module.exports = "ok";'
    });
    await board.publish('got:reasoning-complete', {
      author: 'channel-test',
      totalSynergies: 3
    });

    const reviewRequested = await board.get('governance:review:requested');
    const gotComplete = await board.get('knowledge:got:completed');

    assert.equal(reviewRequested.taskId, 'task-2');
    assert.equal(gotComplete.totalSynergies, 3);
  });

  it('subscriber wrapper should receive legacy dispatch messages when subscribed to canonical execution channel', async () => {
    const subscriber = await board.createSubscriber();
    let received = null;

    await subscriber.subscribe('execution:dispatch:test-agent', (msg) => {
      received = msg;
    });

    await board.publish('command:test-agent:task', {
      author: 'channel-test',
      action: 'implement_story'
    });

    await sleep(100);

    assert.ok(received, 'Expected canonical subscriber to receive aliased dispatch message');
    assert.equal(received.action, 'implement_story');
    await subscriber.disconnect();
  });
});
