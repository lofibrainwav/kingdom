/**
 * Integration Tests — Vibe Coding Architecture
 *
 * Checks that the PM, Architect, and Blackboard correctly wire up
 * and communicate via Redis pub/sub.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { Blackboard } = require('../agent/core/blackboard');

describe('Integration — Vibe Coding Mappings (Phase 6)', () => {
    let board;

    before(async () => {
        board = new Blackboard();
        await board.connect();
    });

    after(async () => {
        await board.disconnect();
    });

    it('Should enable cross-agent communication via Blackboard primitives', async () => {
        const sub = await board.createSubscriber();
        let received = null;
        
        await sub.subscribe('octiv:pm:to:architect', (msg) => {
            received = typeof msg === 'string' ? JSON.parse(msg) : msg;
        });

        await board.publish('pm:to:architect', { task: 'build_ui', author: 'integration-test' });

        // Wait a tiny bit for redis pub/sub
        await new Promise(r => setTimeout(r, 100));

        assert.ok(received, 'Should have received message from PM to Architect');
        assert.equal(received.task, 'build_ui');

        await sub.disconnect();
    });

    it('Should support Zettelkasten XP tracking through Blackboard Hash maps', async () => {
        await board.setHashField('zettelkasten:xp', 'playwright_browser', 12);
        const xp = await board.getHashField('zettelkasten:xp', 'playwright_browser');
        assert.equal(parseInt(xp, 10), 12);

        await board.deleteHashField('zettelkasten:xp', 'playwright_browser');
    });
});
