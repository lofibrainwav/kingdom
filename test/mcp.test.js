/**
 * MCP Tool Server Tests — Phase 2.5
 * Usage: node --test test/mcp.test.js
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

describe('MCPServer — JSON-RPC 2.0 (Phase 2.5)', () => {
    let MCPServer;
    let server;
    let redisClient;
    const PORT = 3099; // test port

    before(async () => {
        const { createClient } = require('redis');
        redisClient = createClient({ url: 'redis://localhost:6380' });
        await redisClient.connect();

        MCPServer = require('../agent/mcp-server').MCPServer;
        server = new MCPServer(PORT);
        await server.start();

        // Pre-seed some Blackboard data
        await redisClient.set('octiv:team:status:latest', JSON.stringify({
            ts: Date.now(), status: 'running', mission: 'test',
        }));
        await redisClient.set('octiv:agent:builder-01:inventory:latest', JSON.stringify({
            ts: Date.now(), wood: 16,
        }));
    });

    after(async () => {
        await server.stop();
        const keys = await redisClient.keys('octiv:command:*');
        if (keys.length > 0) await redisClient.del(keys);
        await redisClient.disconnect();
    });

    function rpcCall(method, params = {}) {
        return new Promise((resolve, reject) => {
            const body = JSON.stringify({
                jsonrpc: '2.0', method, params, id: 1,
            });
            const req = http.request({
                hostname: 'localhost', port: PORT, path: '/mcp',
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
            }, (res) => {
                let data = '';
                res.on('data', chunk => { data += chunk; });
                res.on('end', () => resolve(JSON.parse(data)));
            });
            req.on('error', reject);
            req.write(body);
            req.end();
        });
    }

    it('Should return team status via getStatus', async () => {
        const res = await rpcCall('getStatus');
        assert.equal(res.jsonrpc, '2.0');
        assert.ok(res.result.team, 'Should have team status');
        assert.equal(res.result.team.status, 'running');
        assert.equal(res.id, 1);
    });

    it('Should dispatch moveTo command', async () => {
        const res = await rpcCall('moveTo', { agentId: 'builder-01', x: 10, y: 64, z: -20 });
        assert.equal(res.result.command, 'moveTo');
        assert.equal(res.result.status, 'dispatched');
        assert.deepEqual(res.result.target, { x: 10, y: 64, z: -20 });
    });

    it('Should dispatch chopTree command', async () => {
        const res = await rpcCall('chopTree', { agentId: 'builder-01' });
        assert.equal(res.result.command, 'chopTree');
        assert.equal(res.result.status, 'dispatched');
    });

    it('Should return agent inventory', async () => {
        const res = await rpcCall('inventory', { agentId: 'builder-01' });
        assert.ok(res.result.inventory);
        assert.equal(res.result.inventory.wood, 16);
    });

    it('Should return error for unknown method', async () => {
        const res = await rpcCall('unknownMethod');
        assert.ok(res.error);
        assert.equal(res.error.code, -32601);
    });

    it('Should return error for invalid JSON-RPC', async () => {
        const res = await new Promise((resolve, reject) => {
            const body = JSON.stringify({ method: 'getStatus' }); // missing jsonrpc
            const req = http.request({
                hostname: 'localhost', port: PORT, path: '/mcp',
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
            }, (res) => {
                let data = '';
                res.on('data', chunk => { data += chunk; });
                res.on('end', () => resolve(JSON.parse(data)));
            });
            req.on('error', reject);
            req.write(body);
            req.end();
        });
        assert.ok(res.error);
        assert.equal(res.error.code, -32600);
    });

    it('Should return 404 for non-/mcp paths', async () => {
        const res = await new Promise((resolve, reject) => {
            const req = http.request({
                hostname: 'localhost', port: PORT, path: '/other',
                method: 'POST',
            }, (res) => {
                resolve(res.statusCode);
            });
            req.on('error', reject);
            req.end();
        });
        assert.equal(res, 404);
    });

    it('Should return error for missing required params', async () => {
        const res = await rpcCall('moveTo', { agentId: 'builder-01' }); // missing x,y,z
        assert.ok(res.error);
        assert.equal(res.error.code, -32000);
    });
});
