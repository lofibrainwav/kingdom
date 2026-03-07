/**
 * VaultBridge tests.
 * Tests event handlers, Obsidian REST helpers, message parsing, and slugification.
 */
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { VaultBridge } = require('../agent/memory/vault-bridge');

// ── Mock Helpers ────────────────────────────────────────────

function createMockBoard() {
  return {
    connect: async () => {},
    disconnect: async () => {},
    client: { isOpen: false },
    createSubscriber: async () => ({
      on: () => {},
      subscribe: async () => {},
      disconnect: async () => {},
    }),
  };
}

function createBridge(overrides = {}) {
  const bridge = new VaultBridge({
    obsidianToken: 'test-token',
    obsidianBase: 'http://localhost:27124',
    board: createMockBoard(),
    ...overrides,
  });
  bridge.enabled = true;
  return bridge;
}

// ── _parseMessage ───────────────────────────────────────────

describe('VaultBridge — _parseMessage', () => {
  let bridge;
  beforeEach(() => { bridge = createBridge(); });

  it('should return empty object for null', () => {
    assert.deepEqual(bridge._parseMessage(null), {});
  });

  it('should return empty object for undefined', () => {
    assert.deepEqual(bridge._parseMessage(undefined), {});
  });

  it('should parse valid JSON string', () => {
    const result = bridge._parseMessage('{"taskId":"t1"}');
    assert.equal(result.taskId, 't1');
  });

  it('should return empty object for invalid JSON string', () => {
    assert.deepEqual(bridge._parseMessage('not-json{'), {});
  });

  it('should pass through objects directly', () => {
    const obj = { taskId: 't2', projectId: 'p1' };
    assert.deepEqual(bridge._parseMessage(obj), obj);
  });
});

// ── _slugify ────────────────────────────────────────────────

describe('VaultBridge — _slugify', () => {
  let bridge;
  beforeEach(() => { bridge = createBridge(); });

  it('should lowercase', () => {
    assert.equal(bridge._slugify('Hello-World'), 'hello-world');
  });

  it('should replace special chars with hyphens', () => {
    assert.equal(bridge._slugify('task #1: fix bug!'), 'task-1-fix-bug');
  });

  it('should trim leading/trailing hyphens', () => {
    assert.equal(bridge._slugify('---hello---'), 'hello');
  });

  it('should truncate to 80 chars', () => {
    const long = 'a'.repeat(100);
    assert.equal(bridge._slugify(long).length, 80);
  });

  it('should handle empty string', () => {
    assert.equal(bridge._slugify(''), '');
  });
});

// ── handleTaskCompleted ─────────────────────────────────────

describe('VaultBridge — handleTaskCompleted', () => {
  it('should generate markdown with task data and call _obsidianPut', async () => {
    const bridge = createBridge();
    let putPath = null;
    let putContent = null;
    bridge._obsidianPut = async (path, content) => { putPath = path; putContent = content; };

    await bridge.handleTaskCompleted({
      taskId: 'task-42',
      projectId: 'proj-1',
      verificationCount: 3,
      summary: 'Fixed the bug',
    });

    assert.equal(putPath.includes('05-Operations/kingdom-tasks/task-42.md'), true);
    assert.equal(putContent.includes('governance:task:completed'), true);
    assert.equal(putContent.includes('tags: [type/task, source/vault-bridge, status/active]'), true);
    assert.equal(putContent.includes('related: ["[[kingdom/infrastructure]]"]'), true);
    assert.equal(putContent.includes('proj-1'), true);
    assert.equal(putContent.includes('Fixed the bug'), true);
    assert.equal(putContent.includes('3'), true);
  });

  it('should handle missing fields gracefully', async () => {
    const bridge = createBridge();
    let putPath = null;
    let putContent = null;
    bridge._obsidianPut = async (path, content) => { putPath = path; putContent = content; };

    await bridge.handleTaskCompleted({});

    assert.equal(putPath.includes('unknown-task'), true);
    assert.equal(putContent.includes('project: "unknown"'), true);
  });

  it('should handle string message (JSON)', async () => {
    const bridge = createBridge();
    let putPath = null;
    bridge._obsidianPut = async (path) => { putPath = path; };

    await bridge.handleTaskCompleted(JSON.stringify({ taskId: 'from-string' }));

    assert.equal(putPath.includes('from-string'), true);
  });
});

// ── handleNotebookLMIngested ────────────────────────────────

describe('VaultBridge — handleNotebookLMIngested', () => {
  it('should generate markdown with ingestion data', async () => {
    const bridge = createBridge();
    let putPath = null;
    let putContent = null;
    bridge._obsidianPut = async (path, content) => { putPath = path; putContent = content; };

    await bridge.handleNotebookLMIngested({
      sourceTitle: 'Weekly Research W10',
      sourcePath: '02-Research/weekly-2026-W10.md',
      projectId: 'knowledge-os',
      summary: 'Ingested weekly research notes',
    });

    assert.equal(putPath.includes('02-Research/kingdom-ingested-weekly-research-w10.md'), true);
    assert.equal(putContent.includes('knowledge:notebooklm:ingested'), true);
    assert.equal(putContent.includes('tags: [type/research, source/vault-bridge, status/active]'), true);
    assert.equal(putContent.includes('related: ["[[weekly-questions]]"]'), true);
    assert.equal(putContent.includes('Weekly Research W10'), true);
    assert.equal(putContent.includes('Ingested weekly research notes'), true);
  });

  it('should fallback to sourcePath for slug when no sourceTitle', async () => {
    const bridge = createBridge();
    let putPath = null;
    bridge._obsidianPut = async (path) => { putPath = path; };

    await bridge.handleNotebookLMIngested({ sourcePath: '/some/path.md' });

    assert.equal(putPath.includes('kingdom-ingested-'), true);
    assert.equal(putPath.includes('some-path-md'), true);
  });
});

// ── handleCaptureStored ─────────────────────────────────────

describe('VaultBridge — handleCaptureStored', () => {
  it('should generate markdown with capture data', async () => {
    const bridge = createBridge();
    let putPath = null;
    let putContent = null;
    bridge._obsidianPut = async (path, content) => { putPath = path; putContent = content; };

    await bridge.handleCaptureStored({
      title: 'Completed task-1',
      projectId: 'proj-1',
      outcome: 'passed',
      author: 'knowledge-operator',
      notePath: '/vault/05-Operations/completed-task-1.md',
      retryCategory: 'syntax',
      improvementNote: 'Fixed parsing logic',
    });

    assert.equal(putPath.includes('05-Operations/knowledge-captures/completed-task-1.md'), true);
    assert.equal(putContent.includes('knowledge:capture:stored'), true);
    assert.equal(putContent.includes('tags: [type/insight, source/vault-bridge, status/active]'), true);
    assert.equal(putContent.includes('related: ["[[metacognition]]"]'), true);
    assert.equal(putContent.includes('passed'), true);
    assert.equal(putContent.includes('syntax'), true);
    assert.equal(putContent.includes('Fixed parsing logic'), true);
  });

  it('should handle missing fields with defaults', async () => {
    const bridge = createBridge();
    let putContent = null;
    bridge._obsidianPut = async (_, content) => { putContent = content; };

    await bridge.handleCaptureStored({});

    assert.equal(putContent.includes('unknown'), true);
    assert.equal(putContent.includes('none'), true);
  });
});

// ── _obsidianPut ────────────────────────────────────────────

describe('VaultBridge — _obsidianPut', () => {
  it('should call fetch with PUT method and correct headers', async () => {
    const bridge = createBridge();
    let fetchArgs = null;
    const origFetch = global.fetch;
    global.fetch = async (url, opts) => { fetchArgs = { url, opts }; return { ok: true }; };

    await bridge._obsidianPut('05-Operations/test.md', '# Test');

    global.fetch = origFetch;

    assert.equal(fetchArgs.url.includes('localhost:27124'), true);
    assert.equal(fetchArgs.url.includes('05-Operations'), true);
    assert.equal(fetchArgs.opts.method, 'PUT');
    assert.equal(fetchArgs.opts.headers.Authorization, 'Bearer test-token');
    assert.equal(fetchArgs.opts.headers['Content-Type'], 'application/markdown');
    assert.equal(fetchArgs.opts.body, '# Test');
  });

  it('should throw on non-ok response', async () => {
    const bridge = createBridge();
    const origFetch = global.fetch;
    global.fetch = async () => ({ ok: false, status: 404 });

    await assert.rejects(
      () => bridge._obsidianPut('bad/path.md', 'content'),
      (err) => err.message.includes('404')
    );

    global.fetch = origFetch;
  });
});

// ── _obsidianAppend ─────────────────────────────────────────

describe('VaultBridge — _obsidianAppend', () => {
  it('should call fetch with POST method', async () => {
    const bridge = createBridge();
    let fetchOpts = null;
    const origFetch = global.fetch;
    global.fetch = async (_, opts) => { fetchOpts = opts; return { ok: true }; };

    await bridge._obsidianAppend('05-Operations/test.md', 'appended');

    global.fetch = origFetch;

    assert.equal(fetchOpts.method, 'POST');
    assert.equal(fetchOpts.body, 'appended');
  });

  it('should throw on non-ok response', async () => {
    const bridge = createBridge();
    const origFetch = global.fetch;
    global.fetch = async () => ({ ok: false, status: 500 });

    await assert.rejects(
      () => bridge._obsidianAppend('path.md', 'content'),
      (err) => err.message.includes('500')
    );

    global.fetch = origFetch;
  });
});

// ── Integration: start() subscribes to correct channels ─────

describe('VaultBridge — start() channel subscriptions', () => {
  it('should subscribe to 6 event channels when enabled', async () => {
    const channels = [];
    const bridge = createBridge();
    bridge.board = {
      ...createMockBoard(),
      createSubscriber: async () => ({
        on: () => {},
        subscribe: async (ch) => { channels.push(ch); },
        disconnect: async () => {},
      }),
    };

    await bridge.start();

    assert.equal(channels.length, 6);
    assert.equal(channels.includes('governance:task:completed'), true);
    assert.equal(channels.includes('knowledge:notebooklm:ingested'), true);
    assert.equal(channels.includes('knowledge:capture:stored'), true);
    assert.equal(channels.includes('governance:teamlead:reviewed'), true);
    assert.equal(channels.includes('governance:teamlead:vibe-translated'), true);
    assert.equal(channels.includes('knowledge:research:completed'), true);
  });
});

// ── handleTeamLeadReviewed ────────────────────────────────

describe('VaultBridge — handleTeamLeadReviewed', () => {
  it('should generate markdown with review scores and call _obsidianPut', async () => {
    const bridge = createBridge();
    let putPath = null;
    let putContent = null;
    bridge._obsidianPut = async (path, content) => { putPath = path; putContent = content; };

    await bridge.handleTeamLeadReviewed({
      projectId: 'proj-1',
      taskIds: ['T1', 'T2'],
      batchSize: 2,
      verdict: 'pass',
      scores: { truth: 4, goodness: 5, beauty: 3 },
      summary: 'Solid batch',
      storeWorthy: true,
    });

    assert.equal(putPath.includes('05-Operations/teamlead-reviews/'), true);
    assert.equal(putContent.includes('governance:teamlead:reviewed'), true);
    assert.equal(putContent.includes('tags: [type/review, source/vault-bridge, status/active]'), true);
    assert.equal(putContent.includes('related: ["[[metacognition]]"]'), true);
    assert.equal(putContent.includes('pass'), true);
    assert.equal(putContent.includes('Truth=4'), true);
    assert.equal(putContent.includes('Solid batch'), true);
  });
});

// ── handleVibeTranslated ──────────────────────────────────

describe('VaultBridge — handleVibeTranslated', () => {
  it('should generate markdown with vibe patterns and call _obsidianPut', async () => {
    const bridge = createBridge();
    let putPath = null;
    let putContent = null;
    bridge._obsidianPut = async (path, content) => { putPath = path; putContent = content; };

    await bridge.handleVibeTranslated({
      projectId: 'proj-1',
      taskIds: ['T1'],
      failureCount: 1,
      patterns: [{ intent: 'clean code', gap: 'naming', guardrail: 'use camelCase' }],
      metaInsight: 'Naming is key',
      suggestedPromptPatch: 'Always use camelCase',
    });

    assert.equal(putPath.includes('05-Operations/teamlead-vibes/'), true);
    assert.equal(putContent.includes('governance:teamlead:vibe-translated'), true);
    assert.equal(putContent.includes('tags: [type/pattern, source/vault-bridge, status/active]'), true);
    assert.equal(putContent.includes('related: ["[[kingdom/patterns]]"]'), true);
    assert.equal(putContent.includes('Naming is key'), true);
    assert.equal(putContent.includes('camelCase'), true);
    assert.equal(putContent.includes('clean code'), true);
  });
});

// ── handleResearchCompleted ───────────────────────────────

describe('VaultBridge — handleResearchCompleted', () => {
  it('should generate markdown with research data and call _obsidianPut', async () => {
    const bridge = createBridge();
    let putPath = null;
    let putContent = null;
    bridge._obsidianPut = async (path, content) => { putPath = path; putContent = content; };

    await bridge.handleResearchCompleted({
      projectId: 'proj-1',
      question: 'How does Redis pub/sub work?',
      researchId: 'research-12345',
      hasGrokAnswer: true,
      hasNlmAnswer: false,
    });

    assert.equal(putPath.includes('02-Research/kingdom-research/'), true);
    assert.equal(putContent.includes('knowledge:research:completed'), true);
    assert.equal(putContent.includes('tags: [type/research, source/vault-bridge, status/active]'), true);
    assert.equal(putContent.includes('related: ["[[weekly-questions]]"]'), true);
    assert.equal(putContent.includes('Redis pub/sub'), true);
    assert.equal(putContent.includes('Grok Answer**: Yes'), true);
    assert.equal(putContent.includes('NLM Answer**: No'), true);
  });
});
