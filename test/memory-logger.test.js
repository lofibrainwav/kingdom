const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const { MemoryLogger } = require('../agent/core/memory-logger');

describe('MemoryLogger', () => {
  let logDir;
  let logger;

  beforeEach(async () => {
    logDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'kingdom-memlog-'));
    logger = new MemoryLogger(logDir);
  });

  afterEach(async () => {
    await fsp.rm(logDir, { recursive: true, force: true });
  });

  it('logEvent writes JSONL entry to disk', async () => {
    await logger.logEvent('Kingdom_PM', { type: 'task:started', goal: 'test' });

    const history = await logger.getHistory('Kingdom_PM');
    assert.equal(history.length, 1);
    assert.equal(history[0].agentId, 'Kingdom_PM');
    assert.equal(history[0].type, 'task:started');
    assert.equal(history[0].goal, 'test');
    assert.ok(history[0].ts);
  });

  it('logEvent appends multiple entries', async () => {
    await logger.logEvent('Kingdom_PM', { type: 'start' });
    await logger.logEvent('Kingdom_PM', { type: 'progress' });
    await logger.logEvent('Kingdom_PM', { type: 'done' });

    const history = await logger.getHistory('Kingdom_PM');
    assert.equal(history.length, 3);
    assert.equal(history[0].type, 'start');
    assert.equal(history[2].type, 'done');
  });

  it('getHistory returns empty array for non-existent agent', async () => {
    const history = await logger.getHistory('nonexistent');
    assert.deepEqual(history, []);
  });

  it('getByType filters events by type', async () => {
    await logger.logEvent('Kingdom_Coder', { type: 'compile', file: 'a.js' });
    await logger.logEvent('Kingdom_Coder', { type: 'test', file: 'a.test.js' });
    await logger.logEvent('Kingdom_Coder', { type: 'compile', file: 'b.js' });

    const compiles = await logger.getByType('Kingdom_Coder', 'compile');
    assert.equal(compiles.length, 2);
    assert.equal(compiles[0].file, 'a.js');
    assert.equal(compiles[1].file, 'b.js');
  });

  it('clear removes agent log file', async () => {
    await logger.logEvent('Kingdom_Reviewer', { type: 'review' });
    let history = await logger.getHistory('Kingdom_Reviewer');
    assert.equal(history.length, 1);

    await logger.clear('Kingdom_Reviewer');
    history = await logger.getHistory('Kingdom_Reviewer');
    assert.deepEqual(history, []);
  });

  it('clear on non-existent file does not throw', async () => {
    let threw = false;
    try { await logger.clear('nonexistent'); } catch { threw = true; }
    assert.equal(threw, false, 'clear should not throw for missing file');
  });

  it('logEvent handles write error gracefully', async () => {
    const badLogger = new MemoryLogger(logDir);
    badLogger.logDir = '/nonexistent/path/that/cannot/exist';
    let threw = false;
    try { await badLogger.logEvent('test', { type: 'fail' }); } catch { threw = true; }
    assert.equal(threw, false, 'logEvent should swallow write errors');
  });
});
