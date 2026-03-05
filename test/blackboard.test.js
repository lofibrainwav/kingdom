/**
 * Blackboard Integration Test — Uses real Redis (port 6380)
 * Usage: node --test test/blackboard.test.js
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { Blackboard } = require('../agent/core/blackboard');

describe('Blackboard — Redis Integration', () => {
  let board;

  before(async () => {
    board = new Blackboard();
    await board.connect();
    // Cleanup previous test keys before running tests
    const client = board.client;
    const keys = await client.keys('octiv:test:*');
    if (keys.length > 0) {
      await client.del(keys);
    }
  });

  after(async () => {
    // Cleanup test keys after tests
    const client = board.client;
    const keys = await client.keys('octiv:test:*');
    if (keys.length > 0) {
      await client.del(keys);
    }
    await board.disconnect();
  });

  it('Should successfully connect to Redis', () => {
    assert.ok(board.client.isReady, 'Redis client should be ready');
  });

  it('Should support publish -> get roundtrip', async () => {
    const testData = {
      author: 'test',
      status: 'spawned',
      position: { x: 10, y: 64, z: -20 },
      health: 20,
      food: 20,
    };

    await board.publish('test:roundtrip', testData);
    const result = await board.get('test:roundtrip');

    assert.ok(result, 'Published data should be retrievable');
    assert.equal(result.status, 'spawned');
    assert.deepStrictEqual(result.position, { x: 10, y: 64, z: -20 });
    assert.equal(result.health, 20);
    assert.ok(result.ts, 'Timestamp should be included');
  });

  it('Should set TTL on :latest keys (300s)', async () => {
    await board.publish('test:ttl', { author: 'test', check: true });

    const ttl = await board.client.ttl('octiv:test:ttl:latest');
    assert.ok(ttl > 0, `TTL should be positive, got: ${ttl}`);
    assert.ok(ttl <= 300, `TTL should be <= 300, got: ${ttl}`);
  });

  it('Should return null for non-existent channels', async () => {
    const result = await board.get('test:nonexistent_channel_xyz');
    assert.equal(result, null, 'Non-existent channel should return null');
  });

  it('Should manage AC progress correctly', async () => {
    await board.updateAC('test-bot', 1, 'in_progress');
    await board.updateAC('test-bot', 2, 'done');

    const progress = await board.getACProgress('test-bot');
    assert.ok(progress['AC-1'], 'AC-1 should exist');
    assert.ok(progress['AC-2'], 'AC-2 should exist');

    const ac1 = JSON.parse(progress['AC-1']);
    assert.equal(ac1.status, 'in_progress');

    const ac2 = JSON.parse(progress['AC-2']);
    assert.equal(ac2.status, 'done');
  });

  it('Should maintain a maximum of 50 reflexion logs', async () => {
    // Generate 55 logs
    for (let i = 0; i < 55; i++) {
      await board.logReflexion('test-bot', { error: `test-error-${i}`, iteration: i });
    }

    const logs = await board.client.lRange('octiv:agent:test-bot:reflexion', 0, -1);
    assert.ok(logs.length <= 50, `Should keep max 50, got: ${logs.length}`);
  });

  // ── 眞善美孝永 Validation Tests ──────────────────────────────

  it('孝: Should reject publish without author', async () => {
    await assert.rejects(
      () => board.publish('test:no-author', { status: 'oops' }),
      { message: /孝.*author field is required/ }
    );
  });

  it('眞: Should reject publish with empty channel', async () => {
    await assert.rejects(
      () => board.publish('', { author: 'test', status: 'ok' }),
      { message: /眞.*channel must be a non-empty string/ }
    );
  });

  it('眞: Should reject publish with non-object data', async () => {
    await assert.rejects(
      () => board.publish('test:bad-data', 'not-an-object'),
      { message: /眞.*data must be a non-empty object/ }
    );
  });

  it('善: Should reject publish with oversized payload (>10KB)', async () => {
    const bigData = { author: 'test', blob: 'x'.repeat(11000) };
    await assert.rejects(
      () => board.publish('test:big', bigData),
      { message: /善.*payload too large/ }
    );
  });

  it('美: Should reject publish with invalid channel name', async () => {
    await assert.rejects(
      () => board.publish('Test:UPPER', { author: 'test', ok: true }),
      { message: /美.*channel must be lowercase/ }
    );
    await assert.rejects(
      () => board.publish('test channel', { author: 'test', ok: true }),
      { message: /美.*channel must be lowercase/ }
    );
  });

  it('Should accept valid publish with author', async () => {
    await board.publish('test:valid', { author: 'test-agent', value: 42 });
    const result = await board.get('test:valid');
    assert.equal(result.author, 'test-agent');
    assert.equal(result.value, 42);
    assert.ok(result.ts, 'Timestamp should be present');
  });

  it('孝: batchPublish should reject entries without author', async () => {
    await assert.rejects(
      () => board.batchPublish([
        { channel: 'test:batch1', data: { author: 'test', ok: true } },
        { channel: 'test:batch2', data: { missing: true } },
      ]),
      { message: /孝.*author field is required/ }
    );
  });

  it('should disconnect cleanly even if client disconnect fails (forced)', async () => {
    const errorBoard = new Blackboard();
    errorBoard.client = {
      isOpen: true,
      quit: async () => { throw new Error('quit error'); }, // lines 40-41
      disconnect: async () => { throw new Error('disconnect error'); } // 44-45
    };
    await errorBoard.disconnect();
    assert.ok(1);
  });

  it('reconnectStrategy should cap at MAX attempts', () => {
    const T = require('../config/timeouts');
    const b = new Blackboard();
    const strategy = b.client.options.socket.reconnectStrategy;
    assert.equal(strategy(T.MAX_RECONNECT_ATTEMPTS + 1), false);
    assert.equal(strategy(1), 100);
  });

  it('atomicUpdateSkill should return null on repeated WATCH conflicts', async () => {
    // lines 183-186
    const boardMock = new Blackboard();
    boardMock.client = { hGet: async () => '"{}"', watch: async () => {}, multi: () => ({ hSet: () => {}, exec: async () => { throw new Error('transaction fail') } }) };
    const result = await boardMock.atomicUpdateSkill('conflict-skill', () => ({}));
    assert.equal(result, null);
  });
});

describe('Blackboard — Supplemental methods', () => {
  let board;

  before(async () => {
    board = new Blackboard();
    await board.connect();
    const keys = await board.client.keys('octiv:sup:*');
    if (keys.length > 0) await board.client.del(keys);
  });

  after(async () => {
    const keys = await board.client.keys('octiv:sup:*');
    if (keys.length > 0) await board.client.del(keys);
    await board.disconnect();
  });

  it('saveSkill and getSkill should work', async () => {
    await board.saveSkill('sup:jump', { cost: 5 });
    const skill = await board.getSkill('sup:jump');
    assert.equal(skill.cost, 5);
  });

  it('batchPublish and batchGet should work', async () => {
    const res = await board.batchPublish([
      { channel: 'sup:b1', data: { author: 't', val: 1 } },
      { channel: 'sup:b2', data: { author: 't', val: 2 } }
    ]);
    assert.equal(res.count, 2);
    
    const results = await board.batchGet(['sup:b1', 'sup:b2', 'sup:missing']);
    assert.equal(results.length, 3);
    assert.equal(results[0].val, 1);
    assert.equal(results[1].val, 2);
    assert.equal(results[2], null);
  });

  it('batchUpdateAC should update multiple ACs', async () => {
    await board.batchUpdateAC([
      { agentId: 'sup-agent', acNum: 1, status: 'done' },
      { agentId: 'sup-agent', acNum: 2, status: 'todo' }
    ]);
    const progress = await board.getACProgress('sup-agent');
    assert.equal(JSON.parse(progress['AC-1']).status, 'done');
    assert.equal(JSON.parse(progress['AC-2']).status, 'todo');
  });

  it('atomicUpdateSkill should safely read-modify-write', async () => {
    await board.saveSkill('sup:dig', { uses: 0 });
    
    // update success
    const updated = await board.atomicUpdateSkill('sup:dig', (s) => ({ uses: s.uses + 1 }));
    assert.equal(updated.uses, 1);
    
    // get verify
    const chk = await board.getSkill('sup:dig');
    assert.equal(chk.uses, 1);

    // returning null in updater drops the update
    const drop = await board.atomicUpdateSkill('sup:dig', () => null);
    assert.equal(drop, null);
    
    // missing skill returns null
    const miss = await board.atomicUpdateSkill('sup:missing', (s) => s);
    assert.equal(miss, null);
  });

  it('getConfig and setConfig should work', async () => {
    await board.setConfig('sup:config:test', { a: 1 });
    const cfg = await board.getConfig('sup:config:test');
    assert.equal(cfg.a, 1);
    
    const miss = await board.getConfig('sup:config:missing');
    assert.equal(miss, null);
  });

  it('Hash fields: setHashField, getHashField, getHash, deleteHashField', async () => {
    await board.setHashField('sup:hash1', 'fieldA', { x: 10 });
    await board.setHashField('sup:hash1', 'fieldB', { x: 20 });
    
    const a = await board.getHashField('sup:hash1', 'fieldA');
    assert.equal(a.x, 10);
    
    const miss = await board.getHashField('sup:hash1', 'fieldC');
    assert.equal(miss, null);

    const full = await board.getHash('sup:hash1');
    assert.ok(full['fieldA']);
    assert.ok(full['fieldB']);

    await board.deleteHashField('sup:hash1', 'fieldA');
    const bAfter = await board.getHashField('sup:hash1', 'fieldA');
    assert.equal(bAfter, null);
  });

  it('getListRange should retrieve list elements', async () => {
    // isolated agent ID
    const aid = 'sup-logs-' + Date.now();
    await board.logReflexion(aid, { text: 'a' });
    await board.logReflexion(aid, { text: 'b' });

    const list = await board.getListRange(`agent:${aid}:reflexion`, 0, -1);
    assert.equal(list.length, 2); // 'b' is pushed to left, then 'a'
  });

  it('createSubscriber should return an open duplicate client', async () => {
    const sub = await board.createSubscriber();
    assert.ok(sub.isReady);
    await sub.quit();
  });
  
  it('disconnect force cleanup block handles error', async () => {
    const fresh = new Blackboard();
    fresh.client.quit = async () => { throw new Error('mock quit throw'); };
    // Should suppress error
    await assert.doesNotReject(() => fresh.disconnect());
  });
});

