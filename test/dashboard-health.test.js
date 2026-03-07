const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { DashboardServer } = require('../agent/interface/dashboard');

function httpGet(port, path) {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:${port}${path}`, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
    }).on('error', reject);
  });
}

describe('Dashboard /health endpoint', () => {
  it('returns healthy status with uptime and redis info', async () => {
    const dashboard = new DashboardServer({ port: 0 });
    // Mock board to avoid real Redis
    dashboard.board = {
      connect: async () => {},
      disconnect: async () => {},
      createSubscriber: async () => ({
        on: () => {},
        subscribe: async () => {},
        pSubscribe: async () => {},
        pUnsubscribe: async () => {},
        disconnect: async () => {},
      }),
      client: { isReady: true },
    };

    await dashboard.start();
    const port = dashboard.server.address().port;

    const { status, body } = await httpGet(port, '/health');
    assert.equal(status, 200);
    assert.equal(body.status, 'healthy');
    assert.equal(body.redis, 'connected');
    assert.equal(typeof body.uptime, 'number');
    assert.ok(body.uptime >= 0);
    assert.equal(typeof body.sseClients, 'number');
    assert.equal(typeof body.agentCount, 'number');

    await dashboard.stop();
  });

  it('returns degraded when Redis is disconnected', async () => {
    const dashboard = new DashboardServer({ port: 0 });
    dashboard.board = {
      connect: async () => {},
      disconnect: async () => {},
      createSubscriber: async () => ({
        on: () => {},
        subscribe: async () => {},
        pSubscribe: async () => {},
        pUnsubscribe: async () => {},
        disconnect: async () => {},
      }),
      client: { isReady: false },
    };

    await dashboard.start();
    const port = dashboard.server.address().port;

    const { status, body } = await httpGet(port, '/health');
    assert.equal(status, 503);
    assert.equal(body.status, 'degraded');
    assert.equal(body.redis, 'disconnected');

    await dashboard.stop();
  });
});

describe('Dashboard graceful drain', () => {
  it('returns 503 for requests after stop() begins', async () => {
    const dashboard = new DashboardServer({ port: 0 });
    dashboard.board = {
      connect: async () => {},
      disconnect: async () => {},
      createSubscriber: async () => ({
        on: () => {},
        subscribe: async () => {},
        pSubscribe: async () => {},
        pUnsubscribe: async () => {},
        disconnect: async () => {},
      }),
      client: { isReady: true },
    };

    await dashboard.start();
    const port = dashboard.server.address().port;

    // Verify healthy first
    const before = await httpGet(port, '/health');
    assert.equal(before.status, 200);

    // Set draining flag (simulates stop() beginning)
    dashboard._draining = true;

    const { status, body } = await httpGet(port, '/health');
    assert.equal(status, 503);
    assert.equal(body.status, 'draining');

    await dashboard.stop();
  });
});
