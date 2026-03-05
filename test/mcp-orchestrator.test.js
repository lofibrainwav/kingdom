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
        const commandKeys = await redisClient.keys('octiv:command:*');
        const executionKeys = await redisClient.keys('octiv:execution:*');
        const keys = [...commandKeys, ...executionKeys];
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

    it('Should mirror assigned tasks into canonical execution channels', async () => {
        await orch.registerAgent('canonical-agent', 'coder');
        await orch.assignTask('canonical-agent', { action: 'implement_footer' });

        const legacyRaw = await redisClient.get('octiv:command:canonical-agent:task:latest');
        const canonicalRaw = await redisClient.get('octiv:execution:dispatch:canonical-agent:latest');

        assert.ok(legacyRaw);
        assert.ok(canonicalRaw);
        assert.equal(JSON.parse(legacyRaw).action, 'implement_footer');
        assert.equal(JSON.parse(canonicalRaw).action, 'implement_footer');
    });

    it('Should mirror broadcasts into canonical execution channels', async () => {
        await orch.registerAgent('broadcast-agent', 'test');
        await orch.broadcastCommand({ action: 'sync_context' });

        const legacyRaw = await redisClient.get('octiv:command:broadcast-agent:broadcast:latest');
        const canonicalRaw = await redisClient.get('octiv:execution:broadcast:broadcast-agent:latest');

        assert.ok(legacyRaw);
        assert.ok(canonicalRaw);
        assert.equal(JSON.parse(legacyRaw).action, 'sync_context');
        assert.equal(JSON.parse(canonicalRaw).action, 'sync_context');
    });

    it('Should get agents by role', async () => {
        await orch.registerAgent('role-agent-1', 'special-role');
        await orch.registerAgent('role-agent-2', 'special-role');
        await orch.registerAgent('role-agent-3', 'other-role');
        
        const specials = await orch.getAgentsByRole('special-role');
        assert.ok(specials['role-agent-1']);
        assert.ok(specials['role-agent-2']);
        assert.equal(specials['role-agent-3'], undefined);
    });

    it('Should handle invalid JSON during init registry parsing', async () => {
        await redisClient.hSet('octiv:agents:registry', 'broken-agent', '{ invalid json ');
        const badOrch = new MCPOrchestrator();
        await badOrch.init();
        
        const all = await badOrch.getAllAgents();
        assert.equal(all['broken-agent'], undefined);
        await badOrch.shutdown();
    });
});
