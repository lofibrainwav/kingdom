/**
 * PaperMC Live Tests — Builder Spawn-Await
 *
 * Isolated from integration.test.js to avoid Redis connection interference.
 * Uses top-level it() instead of describe() to avoid Node.js v25 test runner
 * AbortSignal propagation into mineflayer TCP connections.
 *
 * Requires: PaperMC server running on localhost:25565
 * Skips gracefully when server is offline.
 */
const { it } = require('node:test');
const assert = require('node:assert/strict');

it('PaperMC Live — should connect builder and receive spawn event', async (t) => {
  const { BuilderAgent } = require('../agent/builder');
  const builder = new BuilderAgent({
    id: 'live01',
    spawnTimeoutMs: 30000,
  });

  try {
    await builder.init();
    assert.ok(builder.bot, 'Bot should be created');
    assert.ok(builder.bot.entity, 'Bot should have spawned with entity');
  } catch (err) {
    if (err.message.includes('spawn timeout') || err.message.includes('ECONNREFUSED')) {
      t.skip('PaperMC server not available');
      return;
    }
    throw err;
  } finally {
    if (builder.bot) await builder.shutdown();
  }
});
