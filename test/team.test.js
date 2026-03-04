/**
 * Team Orchestrator Tests — monitorGathering polling logic
 * Usage: node --test --test-force-exit test/team.test.js
 *
 * Tests the monitorGathering function from team.js.
 * main() is NOT tested here (requires full agent stack) — covered by integration.test.js.
 */
const { describe, it, after, mock } = require('node:test');
const assert = require('node:assert/strict');

const { monitorGathering, shouldProcessEmergency } = require('../agent/team');

describe('team — monitorGathering', () => {
  const intervals = [];
  after(() => {
    // Clean up any lingering intervals
    for (const id of intervals) clearInterval(id);
  });

  it('should publish team:ac4 when all builders have AC-4 done', async () => {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('test timeout')), 2000);

      const board = {
        getACProgress: mock.fn(async () => ({
          'AC-4': JSON.stringify({ status: 'done' }),
        })),
        publish: mock.fn(async (channel, data) => {
          clearTimeout(timeout);
          assert.equal(channel, 'team:ac4');
          assert.equal(data.status, 'done');
          assert.ok(data.message.includes('3'));
          resolve();
        }),
      };

      const id = monitorGathering(board, 3, 20);
      intervals.push(id);
    });
  });

  it('should keep polling when not all builders arrived', async () => {
    let pollCount = 0;

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        // After 200ms with 20ms interval, should have polled ~10 times
        assert.ok(pollCount >= 3, `Expected 3+ polls, got ${pollCount}`);
        clearInterval(id);
        resolve();
      }, 200);

      const board = {
        getACProgress: mock.fn(async (agentId) => {
          pollCount++;
          // Only builder-01 is done, others not
          if (agentId === 'builder-01') {
            return { 'AC-4': JSON.stringify({ status: 'done' }) };
          }
          return {};
        }),
        publish: mock.fn(async () => {
          clearTimeout(timeout);
          reject(new Error('Should not publish when not all arrived'));
        }),
      };

      const id = monitorGathering(board, 3, 20);
      intervals.push(id);
    });
  });

  it('should ignore polling errors gracefully', async () => {
    let errorCount = 0;

    await new Promise((resolve) => {
      const board = {
        getACProgress: mock.fn(async () => {
          errorCount++;
          if (errorCount <= 2) throw new Error('Redis timeout');
          // After 2 errors, return success to end the test
          return { 'AC-4': JSON.stringify({ status: 'done' }) };
        }),
        publish: mock.fn(async () => {
          assert.ok(errorCount >= 3, 'Should have survived errors');
          resolve();
        }),
      };

      const id = monitorGathering(board, 1, 20);
      intervals.push(id);
    });
  });

  it('should handle missing AC-4 key in progress', async () => {
    let pollCount = 0;

    await new Promise((resolve) => {
      setTimeout(() => {
        clearInterval(id);
        assert.ok(pollCount >= 2, 'Should keep polling');
        resolve();
      }, 150);

      const board = {
        getACProgress: mock.fn(async () => {
          pollCount++;
          return { 'AC-1': JSON.stringify({ status: 'done' }) }; // no AC-4
        }),
        publish: mock.fn(async () => {}),
      };

      const id = monitorGathering(board, 3, 20);
      intervals.push(id);
    });
  });

  it('should handle teamSize=1 correctly', async () => {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('test timeout')), 2000);

      const board = {
        getACProgress: mock.fn(async () => ({
          'AC-4': JSON.stringify({ status: 'done' }),
        })),
        publish: mock.fn(async (channel, data) => {
          clearTimeout(timeout);
          assert.equal(channel, 'team:ac4');
          assert.ok(data.message.includes('1'));
          resolve();
        }),
      };

      const id = monitorGathering(board, 1, 20);
      intervals.push(id);
    });
  });

  it('should return interval ID for cleanup', () => {
    const board = {
      getACProgress: mock.fn(async () => ({})),
      publish: mock.fn(async () => {}),
    };
    const id = monitorGathering(board, 3, 50000);
    assert.ok(id, 'Should return interval ID');
    clearInterval(id);
  });
});

describe('team — shouldProcessEmergency', () => {
  it('should process first emergency of any type', () => {
    const state = { type: null, time: 0 };
    assert.equal(shouldProcessEmergency(state, 'fall', 3000), true);
    assert.equal(state.type, 'fall');
  });

  it('should reject duplicate emergency within dedup window', () => {
    const state = { type: 'fall', time: Date.now() };
    assert.equal(shouldProcessEmergency(state, 'fall', 3000), false);
  });

  it('should allow same type after dedup window expires', () => {
    const state = { type: 'fall', time: Date.now() - 5000 };
    assert.equal(shouldProcessEmergency(state, 'fall', 3000), true);
  });

  it('should allow different type within dedup window', () => {
    const state = { type: 'fall', time: Date.now() };
    assert.equal(shouldProcessEmergency(state, 'lava', 3000), true);
    assert.equal(state.type, 'lava');
  });
});
