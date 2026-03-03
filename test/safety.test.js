/**
 * SafetyAgent Tests — AC-8: Threat Detection
 * Usage: node --test test/safety.test.js
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

describe('SafetyAgent — Threat Detection (AC-8)', () => {
    let SafetyAgent;

    before(() => {
        SafetyAgent = require('../agent/safety').SafetyAgent;
    });

    function createMockBot(overrides = {}) {
        return {
            entity: {
                position: overrides.position || { x: 100, y: 64, z: -200 },
                velocity: overrides.velocity || { x: 0, y: 0, z: 0 },
            },
            health: overrides.health ?? 20,
            findBlock: overrides.findBlock || (() => null),
            registry: { blocksByName: { lava: { id: 999 } } },
        };
    }

    it('Should detect lava threat when Y < 10', () => {
        const safety = new SafetyAgent();
        const bot = createMockBot({ position: { x: 100, y: 5, z: -200 } });
        const threat = safety.detectThreat(bot);
        assert.ok(threat, 'Should detect threat');
        assert.equal(threat.type, 'lava');
    });

    it('Should detect lava threat when lava block nearby', () => {
        const safety = new SafetyAgent();
        const bot = createMockBot({
            findBlock: () => ({ position: { x: 101, y: 64, z: -200 }, name: 'lava' }),
        });
        const threat = safety.detectThreat(bot);
        assert.ok(threat);
        assert.equal(threat.type, 'lava');
    });

    it('Should detect fall threat when velocity.y < -20', () => {
        const safety = new SafetyAgent();
        const bot = createMockBot({ velocity: { x: 0, y: -25, z: 0 } });
        const threat = safety.detectThreat(bot);
        assert.ok(threat);
        assert.equal(threat.type, 'fall');
    });

    it('Should detect fall threat when health is critically low', () => {
        const safety = new SafetyAgent();
        const bot = createMockBot({ health: 8 });
        const threat = safety.detectThreat(bot);
        assert.ok(threat);
        assert.equal(threat.type, 'fall');
    });

    it('Should detect loop threat when reactIterations >= 50', () => {
        const safety = new SafetyAgent();
        safety.reactIterations = 50;
        const bot = createMockBot();
        const threat = safety.detectThreat(bot);
        assert.ok(threat);
        assert.equal(threat.type, 'loop');
    });

    it('Should detect loop threat when same action repeated 8 times', () => {
        const safety = new SafetyAgent();
        safety.actionHistory = Array(8).fill('collectWood');
        const bot = createMockBot();
        const threat = safety.detectThreat(bot);
        assert.ok(threat);
        assert.equal(threat.type, 'loop');
    });

    it('Should return null when no threats detected', () => {
        const safety = new SafetyAgent();
        const bot = createMockBot();
        const threat = safety.detectThreat(bot);
        assert.equal(threat, null);
    });
});

describe('SafetyAgent — vm2 Sandbox Validation (AC-8)', () => {
    let SafetyAgent;

    before(() => {
        SafetyAgent = require('../agent/safety').SafetyAgent;
    });

    it('Should return true for valid code', async () => {
        const safety = new SafetyAgent();
        const result = await safety.verifySkillCode('const x = 1 + 1;');
        assert.equal(result, true);
    });

    it('Should return false for code with syntax errors', async () => {
        const safety = new SafetyAgent();
        const result = await safety.verifySkillCode('const x = {;');
        assert.equal(result, false);
    });
});

describe('SafetyAgent — Threat Handling (AC-8)', () => {
    let SafetyAgent;
    let redisClient;

    before(async () => {
        const { createClient } = require('redis');
        redisClient = createClient({ url: 'redis://localhost:6380' });
        await redisClient.connect();
        SafetyAgent = require('../agent/safety').SafetyAgent;
    });

    after(async () => {
        const keys = await redisClient.keys('octiv:safety:*');
        if (keys.length > 0) await redisClient.del(keys);
        const keys2 = await redisClient.keys('octiv:skills:*');
        if (keys2.length > 0) await redisClient.del(keys2);
        const keys3 = await redisClient.keys('octiv:leader:*');
        if (keys3.length > 0) await redisClient.del(keys3);
        await redisClient.disconnect();
    });

    it('Should publish threat event to Blackboard', async () => {
        const safety = new SafetyAgent();
        await safety.init();

        await safety.handleThreat({ type: 'lava', reason: 'Y=5 < 10' }, 'builder-01');

        const raw = await redisClient.get('octiv:safety:threat:latest');
        assert.ok(raw, 'Threat should be published');
        const data = JSON.parse(raw);
        assert.equal(data.threat.type, 'lava');
        assert.equal(data.agentId, 'builder-01');

        await safety.shutdown();
    });

    it('Should trigger Group Reflexion after 3 consecutive failures', async () => {
        const safety = new SafetyAgent();
        await safety.init();

        await safety.handleThreat({ type: 'fall', reason: 'test1' }, 'builder-01');
        await safety.handleThreat({ type: 'fall', reason: 'test2' }, 'builder-01');
        await safety.handleThreat({ type: 'fall', reason: 'test3' }, 'builder-01');

        const raw = await redisClient.get('octiv:leader:reflexion:latest');
        assert.ok(raw, 'Group Reflexion should be triggered');
        const data = JSON.parse(raw);
        assert.equal(data.type, 'group');

        await safety.shutdown();
    });
});
