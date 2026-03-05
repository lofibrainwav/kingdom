const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { MCPOrchestrator } = require('../agent/interface/mcp-orchestrator');

describe('MCPOrchestrator — Vibe Coding Agent Registry', () => {
    let orch, redisClient;

    before(async () => {
        const { createClient } = require('redis');
        redisClient = createClient({ url: 'redis://localhost:6380' });
        await redisClient.connect();
        await redisClient.del('octiv:agents:registry');
        orch = new MCPOrchestrator();
    });

    after(async () => {
        await redisClient.del('octiv:agents:registry');
        const keys = await redisClient.keys('octiv:command:*');
        if (keys.length > 0) await redisClient.del(keys);
        await orch.shutdown();
        await redisClient.disconnect();
    });

    it('Should register and deregister agents via Redis', async () => {
        await orch.init();
        await orch.registerAgent('test-coder', 'coder');
        
        const all = await orch.getAllAgents();
        assert.ok(all['test-coder']);
        assert.equal(all['test-coder'].role, 'coder');

        await orch.deregisterAgent('test-coder');
        const empty = await orch.getAllAgents();
        assert.equal(empty['test-coder'], undefined);
    });

    it('Should assign specific tasks to registered agents', async () => {
        await orch.registerAgent('ui-coder', 'coder');
        const res = await orch.assignTask('ui-coder', { action: 'implement_header' });
        assert.equal(res.agentId, 'ui-coder');
        assert.equal(res.status, 'assigned');
    });

    it('Should throw when assigning task to unregistered agent', async () => {
        await assert.rejects(
            () => orch.assignTask('ghost-agent', { action: 'test' }),
            /not registered/
        );
    });

    it('Should broadcast command to all registered agents', async () => {
        await orch.registerAgent('bc-agent', 'test');
        await orch.registerAgent('bc-agent2', 'test2');
        const res = await orch.broadcastCommand({ action: 'standup' });
        assert.ok(res.targets.includes('bc-agent'));
        assert.ok(res.targets.includes('bc-agent2'));
        assert.equal(res.status, 'broadcast');
    });
});
