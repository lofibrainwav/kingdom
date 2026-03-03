/**
 * MemoryLogger Tests — AC-7: Disk Persistence
 * Usage: node --test test/memory.test.js
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs');

describe('MemoryLogger — Disk Persistence (AC-7)', () => {
    let MemoryLogger;
    let logger;
    let tmpDir;

    before(() => {
        tmpDir = path.join(os.tmpdir(), `octiv-test-${Date.now()}`);
        MemoryLogger = require('../agent/memory-logger').MemoryLogger;
        logger = new MemoryLogger(tmpDir);
    });

    after(async () => {
        if (fs.existsSync(tmpDir)) {
            fs.rmSync(tmpDir, { recursive: true });
        }
    });

    it('Should create JSONL file and append entries', async () => {
        await logger.logEvent('test-agent', { type: 'ac_progress', ac: 1, status: 'done' });
        await logger.logEvent('test-agent', { type: 'ac_progress', ac: 2, status: 'done' });

        const filePath = path.join(tmpDir, 'test-agent.jsonl');
        assert.ok(fs.existsSync(filePath), 'Log file should exist');

        const lines = fs.readFileSync(filePath, 'utf-8').trim().split('\n');
        assert.equal(lines.length, 2, 'Should have 2 log entries');
    });

    it('Should return all logged events via getHistory', async () => {
        await logger.clear('history-agent');
        await logger.logEvent('history-agent', { type: 'start', msg: 'spawned' });
        await logger.logEvent('history-agent', { type: 'error', msg: 'failed' });
        await logger.logEvent('history-agent', { type: 'improve', msg: 'adapted' });

        const history = await logger.getHistory('history-agent');
        assert.equal(history.length, 3);
        assert.equal(history[0].type, 'start');
        assert.equal(history[1].type, 'error');
        assert.equal(history[2].type, 'improve');
        assert.equal(history[0].agentId, 'history-agent');
    });

    it('Should filter events by type via getByType', async () => {
        await logger.clear('filter-agent');
        await logger.logEvent('filter-agent', { type: 'error', msg: 'path failed' });
        await logger.logEvent('filter-agent', { type: 'improve', msg: 'radius +8' });
        await logger.logEvent('filter-agent', { type: 'error', msg: 'no site' });

        const errors = await logger.getByType('filter-agent', 'error');
        assert.equal(errors.length, 2);
        const improvements = await logger.getByType('filter-agent', 'improve');
        assert.equal(improvements.length, 1);
    });

    it('Should clear agent log file', async () => {
        await logger.logEvent('clear-agent', { type: 'test' });
        const filePath = path.join(tmpDir, 'clear-agent.jsonl');
        assert.ok(fs.existsSync(filePath));

        await logger.clear('clear-agent');
        assert.ok(!fs.existsSync(filePath), 'File should be deleted');
    });

    it('Should return empty array for non-existent agent', async () => {
        const history = await logger.getHistory('no-such-agent');
        assert.deepEqual(history, []);
    });
});
