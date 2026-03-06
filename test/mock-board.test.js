const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createMockBoard } = require('./helpers/mock-board');

describe('createMockBoard — shared mock fidelity', () => {
  it('provides all core Blackboard public methods', () => {
    const { board } = createMockBoard();
    const required = [
      'connect', 'disconnect', 'publish', 'get', 'batchPublish', 'batchGet',
      'createSubscriber', 'setConfig', 'getConfig', 'listConfigs',
      'setHashField', 'getHashField', 'getHash', 'deleteHashField',
      'updateStatus', 'getAllStatuses', 'saveSkill', 'getSkill',
      'atomicUpdateSkill', 'updateAC', 'getACProgress', 'batchUpdateAC',
      'logReflexion', 'getListRange',
    ];
    for (const method of required) {
      assert.equal(typeof board[method], 'function', `missing method: ${method}`);
    }
    assert.ok(board.client.isOpen, 'client.isOpen should be true');
  });

  it('config round-trip works', async () => {
    const { board, configs } = createMockBoard();
    await board.setConfig('test:key', { value: 42 });
    const result = await board.getConfig('test:key');
    assert.deepEqual(result, { value: 42 });
    assert.equal(configs.size, 1);
  });

  it('listConfigs filters by prefix', async () => {
    const { board } = createMockBoard();
    await board.setConfig('tasks:p1:T1', { status: 'started' });
    await board.setConfig('tasks:p1:T2', { status: 'completed' });
    await board.setConfig('other:key', { x: 1 });

    const results = await board.listConfigs('tasks:p1:');
    assert.equal(results.length, 2);
  });

  it('publish and subscribe round-trip works', async () => {
    const { board, published } = createMockBoard();
    const received = [];
    const sub = await board.createSubscriber();
    await sub.subscribe('test:ch', (data) => received.push(data));

    await board.publish('test:ch', { author: 'test', val: 1 });

    assert.equal(published.length, 1);
    assert.equal(received.length, 1);
    assert.equal(received[0].val, 1);
  });

  it('hash operations work end-to-end', async () => {
    const { board } = createMockBoard();
    await board.setHashField('agents:registry', 'agent1', { role: 'coder' });
    await board.setHashField('agents:registry', 'agent2', { role: 'reviewer' });

    const one = await board.getHashField('agents:registry', 'agent1');
    assert.deepEqual(one, { role: 'coder' });

    const all = await board.getHash('agents:registry');
    assert.equal(Object.keys(all).length, 2);

    await board.deleteHashField('agents:registry', 'agent1');
    const deleted = await board.getHashField('agents:registry', 'agent1');
    assert.equal(deleted, null);
  });

  it('updateStatus stores in agents:status hash', async () => {
    const { board, statuses } = createMockBoard();
    await board.updateStatus('Kingdom_PM', { state: 'idle', health: 20 });

    assert.equal(statuses.length, 1);
    assert.equal(statuses[0].agentId, 'Kingdom_PM');

    const all = await board.getAllStatuses();
    assert.deepEqual(all['Kingdom_PM'], { state: 'idle', health: 20 });
  });

  it('createSubscriber returns full API surface', async () => {
    const { board } = createMockBoard();
    const sub = await board.createSubscriber();
    assert.equal(typeof sub.on, 'function');
    assert.equal(typeof sub.subscribe, 'function');
    assert.equal(typeof sub.unsubscribe, 'function');
    assert.equal(typeof sub.pSubscribe, 'function');
    assert.equal(typeof sub.pUnsubscribe, 'function');
    assert.equal(typeof sub.disconnect, 'function');
    assert.equal(typeof sub.quit, 'function');
    assert.equal(sub.isReady, true);
  });

  it('skill operations work', async () => {
    const { board } = createMockBoard();
    await board.saveSkill('test-skill', { score: 90 });
    const skill = await board.getSkill('test-skill');
    assert.deepEqual(skill, { score: 90 });

    const updated = await board.atomicUpdateSkill('test-skill', (s) => ({ ...s, score: 95 }));
    assert.equal(updated.score, 95);
  });
});
