/**
 * NotebookLM Queue Manager tests.
 * Tests the queued → claimed → prepared → ingested pipeline.
 */
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('fs').promises;
const path = require('path');
const os = require('os');
const { NotebookLMQueue } = require('../agent/memory/notebooklm-queue');

// ── Mock Helpers ────────────────────────────────────────────

function createMockBoard(configStore = {}) {
  const published = [];
  return {
    connect: async () => {},
    disconnect: async () => {},
    client: { isOpen: false },
    publish: async (ch, data) => { published.push({ ch, data }); },
    setConfig: async (key, val) => { configStore[key] = val; },
    getConfig: async (key) => configStore[key] || null,
    createSubscriber: async () => ({
      on: () => {},
      subscribe: async () => {},
      disconnect: async () => {},
    }),
    _published: published,
  };
}

const tmpDirs = [];

// ── Constructor & init ──────────────────────────────────────

describe('NotebookLMQueue — constructor', () => {
  it('should initialize with defaults', () => {
    const q = new NotebookLMQueue({ obsidianToken: 'test' });
    assert.equal(q.enabled, true);
    assert.equal(q.processed, 0);
  });
});

describe('NotebookLMQueue — graceful degradation', () => {
  it('should disable when OBSIDIAN_API_KEY is empty', async () => {
    const q = new NotebookLMQueue({ obsidianToken: '', board: createMockBoard() });
    await q.init();
    assert.equal(q.enabled, false);
  });

  it('should enable when token is set', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'nlm-q-'));
    tmpDirs.push(tmpDir);
    const q = new NotebookLMQueue({ obsidianToken: 'test', board: createMockBoard(), packetDir: tmpDir });
    await q.init();
    assert.equal(q.enabled, true);
  });

  it('should skip start() when disabled', async () => {
    const q = new NotebookLMQueue({ obsidianToken: '', board: createMockBoard() });
    await q.init();
    await q.start(); // should not throw
  });

  afterEach(async () => {
    while (tmpDirs.length) await fsp.rm(tmpDirs.pop(), { recursive: true, force: true });
  });
});

// ── processQueued ───────────────────────────────────────────

describe('NotebookLMQueue — processQueued', () => {
  let tmpDir, board, q;

  beforeEach(async () => {
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'nlm-proc-'));
    tmpDirs.push(tmpDir);
    board = createMockBoard();
    q = new NotebookLMQueue({ obsidianToken: 'test', board, packetDir: tmpDir });
    q.enabled = true;
    // Stub Obsidian REST (won't actually be available in tests)
    q._obsidianPut = async () => {};
  });

  afterEach(async () => {
    while (tmpDirs.length) await fsp.rm(tmpDirs.pop(), { recursive: true, force: true });
  });

  it('should process full pipeline: claimed → prepared → ingested', async () => {
    // Create a local source file
    const srcPath = path.join(tmpDir, 'source.md');
    await fsp.writeFile(srcPath, '# Test Source\nSome knowledge content', 'utf-8');

    await q.processQueued({
      author: 'knowledge-operator',
      projectId: 'proj-1',
      taskId: 'task-42',
      sourcePath: srcPath,
      queueType: 'promotion-source',
      sourceTitle: 'My Test Source',
    });

    // Verify 3 events published in order: claimed, prepared, ingested
    assert.equal(board._published.length, 3);
    assert.equal(board._published[0].ch, 'knowledge:notebooklm:claimed');
    assert.equal(board._published[0].data.taskId, 'task-42');
    assert.equal(board._published[1].ch, 'knowledge:notebooklm:prepared');
    assert.ok(board._published[1].data.packetPath.includes('nlm-my-test-source.md'));
    assert.equal(board._published[2].ch, 'knowledge:notebooklm:ingested');
    assert.equal(board._published[2].data.sourceTitle, 'My Test Source');

    // Verify packet file was written
    const files = await fsp.readdir(tmpDir);
    assert.ok(files.includes('nlm-my-test-source.md'));

    // Verify packet content
    const content = await fsp.readFile(path.join(tmpDir, 'nlm-my-test-source.md'), 'utf-8');
    assert.ok(content.includes('# Test Source'));
    assert.ok(content.includes('Some knowledge content'));
    assert.ok(content.includes('notebooklm-packet'));

    // Verify stats
    assert.equal(q.processed, 1);
  });

  it('should handle missing source file gracefully', async () => {
    await q.processQueued({
      projectId: 'p1',
      taskId: 't1',
      sourcePath: '/nonexistent/file.md',
      sourceTitle: 'Missing Source',
    });

    // Should still complete the pipeline
    assert.equal(board._published.length, 3);
    assert.equal(board._published[2].ch, 'knowledge:notebooklm:ingested');

    // Packet should contain fallback content
    const files = await fsp.readdir(tmpDir);
    const packetContent = await fsp.readFile(path.join(tmpDir, files[0]), 'utf-8');
    assert.ok(packetContent.includes('Source file not accessible'));
  });

  it('should skip items with no sourcePath and no taskId', async () => {
    await q.processQueued({});
    assert.equal(board._published.length, 0);
    assert.equal(q.processed, 0);
  });

  it('should handle string messages (JSON)', async () => {
    const srcPath = path.join(tmpDir, 'str-src.md');
    await fsp.writeFile(srcPath, '# String Source', 'utf-8');

    await q.processQueued(JSON.stringify({
      projectId: 'p2',
      taskId: 't2',
      sourcePath: srcPath,
      sourceTitle: 'String Test',
    }));

    assert.equal(board._published.length, 3);
    assert.equal(q.processed, 1);
  });

  it('should update queue status in Blackboard', async () => {
    const configStore = {};
    const boardWithConfig = createMockBoard(configStore);
    const q2 = new NotebookLMQueue({ obsidianToken: 'test', board: boardWithConfig, packetDir: tmpDir });
    q2.enabled = true;
    q2._obsidianPut = async () => {};

    const srcPath = path.join(tmpDir, 'cfg-src.md');
    await fsp.writeFile(srcPath, '# Config Test', 'utf-8');

    await q2.processQueued({
      projectId: 'p3',
      taskId: 't3',
      sourcePath: srcPath,
    });

    const stored = configStore['knowledge:notebooklm:p3:t3:queued'];
    assert.ok(stored);
    assert.equal(stored.status, 'ingested');
    assert.ok(stored.processedAt);
  });

  it('should handle Obsidian PUT failure gracefully', async () => {
    const q2 = new NotebookLMQueue({ obsidianToken: 'test', board, packetDir: tmpDir });
    q2.enabled = true;
    q2._obsidianPut = async () => { throw new Error('Obsidian down'); };

    const srcPath = path.join(tmpDir, 'obs-fail.md');
    await fsp.writeFile(srcPath, '# Obsidian Fail', 'utf-8');

    // Should still complete — Obsidian mirror is non-blocking
    await q2.processQueued({
      projectId: 'p4',
      taskId: 't4',
      sourcePath: srcPath,
      sourceTitle: 'Obs Fail Test',
    });

    assert.equal(board._published.length, 3);
  });
});

// ── _parseMessage ───────────────────────────────────────────

describe('NotebookLMQueue — _parseMessage', () => {
  const q = new NotebookLMQueue();

  it('should return empty object for null', () => {
    assert.deepEqual(q._parseMessage(null), {});
  });

  it('should parse JSON string', () => {
    assert.equal(q._parseMessage('{"a":1}').a, 1);
  });

  it('should return empty object for invalid JSON', () => {
    assert.deepEqual(q._parseMessage('bad{'), {});
  });

  it('should pass through objects', () => {
    const obj = { x: 1 };
    assert.deepEqual(q._parseMessage(obj), obj);
  });
});

// ── _slugify ────────────────────────────────────────────────

describe('NotebookLMQueue — _slugify', () => {
  const q = new NotebookLMQueue();

  it('should lowercase and replace special chars', () => {
    assert.equal(q._slugify('Hello World!'), 'hello-world');
  });

  it('should truncate to 80 chars', () => {
    assert.equal(q._slugify('a'.repeat(100)).length, 80);
  });
});

// ── _renderPacket ───────────────────────────────────────────

describe('NotebookLMQueue — _renderPacket', () => {
  const q = new NotebookLMQueue();

  it('should render complete packet with frontmatter', () => {
    const packet = q._renderPacket({
      sourceTitle: 'Test Source',
      sourcePath: '/vault/test.md',
      projectId: 'proj-1',
      taskId: 'task-1',
      content: '# Content\nSome text',
      queueType: 'promotion-source',
    });

    assert.ok(packet.includes('source: kingdom-nlm-queue'));
    assert.ok(packet.includes('type: notebooklm-packet'));
    assert.ok(packet.includes('Test Source'));
    assert.ok(packet.includes('# Content'));
    assert.ok(packet.includes('promotion-source'));
  });

  it('should handle missing fields', () => {
    const packet = q._renderPacket({});
    assert.ok(packet.includes('unknown'));
    assert.ok(packet.includes('Unknown'));
  });
});

// ── getStats ────────────────────────────────────────────────

describe('NotebookLMQueue — getStats', () => {
  it('should return enabled and processed count', () => {
    const q = new NotebookLMQueue({ obsidianToken: 'test' });
    const stats = q.getStats();
    assert.equal(stats.enabled, true);
    assert.equal(stats.processed, 0);
  });
});

// ── shutdown ────────────────────────────────────────────────

describe('NotebookLMQueue — shutdown', () => {
  it('should disconnect subscriber and board', async () => {
    let subDisconnected = false;
    const q = new NotebookLMQueue();
    q.subscriber = { disconnect: async () => { subDisconnected = true; } };
    q.board = { disconnect: async () => {}, client: null };
    await q.shutdown();
    assert.ok(subDisconnected);
  });

  it('should handle missing subscriber', async () => {
    const q = new NotebookLMQueue();
    q.board = { disconnect: async () => {}, client: null };
    await q.shutdown(); // should not throw
  });
});

// ── team.js registration ────────────────────────────────────

describe('NotebookLMQueue — team.js registration', () => {
  const fs = require('fs');
  const teamSrc = fs.readFileSync(
    path.join(__dirname, '..', 'agent', 'team.js'),
    'utf-8'
  );

  it('should be imported in team.js', () => {
    assert.ok(teamSrc.includes("require('./memory/notebooklm-queue')"));
  });

  it('should be registered in AGENTS', () => {
    assert.ok(teamSrc.includes("name: 'NotebookLMQueue'"));
  });
});
