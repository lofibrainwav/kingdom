const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fsp = require('node:fs/promises');

const { ArchitectAgent } = require('../agent/team/architect');
const { DecomposerAgent } = require('../agent/team/decomposer');
const { CoderAgent } = require('../agent/team/coder');

describe('Planning Continuation Metadata', () => {
  let configs;
  let published;
  let board;
  let workspaceRoot;

  afterEach(async () => {
    if (workspaceRoot) {
      await fsp.rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  beforeEach(() => {
    configs = new Map();
    published = [];
    board = {
      connect: async () => {},
      disconnect: async () => {},
      createSubscriber: async () => ({
        on: () => {},
        subscribe: async () => {},
        disconnect: async () => {},
      }),
      setConfig: async (key, value) => {
        configs.set(key, value);
      },
      publish: async (channel, data) => {
        published.push({ channel, data });
      },
      updateStatus: async () => {},
    };
  });

  it('ArchitectAgent preserves retry continuation metadata into design output', async () => {
    const architect = new ArchitectAgent();
    architect.board = board;
    architect.llm = {
      init: async () => {},
      shutdown: async () => {},
      callLLM: async () => 'stack and folders',
    };

    await architect.handleProjectInit({
      projectId: 'kingdom',
      goal: 'Recover verification gap',
      taskId: 'TASK-501',
      retry: true,
      retryCategory: 'review',
      retryGuardrail: 'missing-evidence',
    });

    const stored = configs.get('kingdom:architecture');
    assert.equal(stored.taskId, 'TASK-501');
    assert.equal(stored.retry, true);
    assert.equal(stored.retryGuardrail, 'missing-evidence');
    assert.equal(published[0].channel, 'work:planning:designed');
    assert.equal(published[0].data.taskId, 'TASK-501');
    assert.equal(published[0].data.retry, true);
  });

  it('DecomposerAgent preserves continuation metadata into coding plan output', async () => {
    const decomposer = new DecomposerAgent();
    decomposer.board = board;
    decomposer.llm = {
      init: async () => {},
      shutdown: async () => {},
      callLLM: async () => ({ tasks: [{ id: 'T1', description: 'Patch tests' }] }),
    };
    decomposer.got = {
      init: async () => {},
      discoverSynergies: async () => ({ path: 'recover' }),
    };

    await decomposer.handleDesignComplete({
      projectId: 'kingdom',
      goal: 'Recover verification gap',
      architecture: 'stack and folders',
      taskId: 'TASK-501',
      retry: true,
      retryCategory: 'review',
      retryGuardrail: 'missing-evidence',
    });

    const stored = configs.get('kingdom:tasks');
    assert.equal(stored.taskId, 'TASK-501');
    assert.equal(stored.retry, true);
    assert.equal(stored.retryCategory, 'review');
    assert.equal(published[0].channel, 'work:planning:decomposed');
    assert.equal(published[0].data.taskId, 'TASK-501');
    assert.equal(published[0].data.retryGuardrail, 'missing-evidence');
  });

  it('CoderAgent carries continuation metadata into task completion artifacts and review requests', async () => {
    workspaceRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'coder-continuation-'));
    const coder = new CoderAgent();
    coder.board = board;
    coder.baseWorkspace = workspaceRoot;
    coder.llm = {
      init: async () => {},
      shutdown: async () => {},
      callLLM: async () => 'module.exports = "ok";',
    };

    await coder.handlePlanComplete({
      projectId: 'kingdom',
      goal: 'Recover verification gap',
      tasks: {
        tasks: [{ id: 'T1', description: 'Patch tests' }],
      },
      taskId: 'TASK-501',
      retry: true,
      retryCategory: 'review',
      retryGuardrail: 'missing-evidence',
    });

    const stored = configs.get('tasks:kingdom:T1');
    assert.equal(stored.continuationTaskId, 'TASK-501');
    assert.equal(stored.retry, true);
    assert.equal(stored.retryGuardrail, 'missing-evidence');

    const reviewEvent = published.find((entry) => entry.channel === 'governance:review:requested');
    assert.ok(reviewEvent);
    assert.equal(reviewEvent.data.continuationTaskId, 'TASK-501');
    assert.equal(reviewEvent.data.retry, true);
    assert.equal(reviewEvent.data.retryCategory, 'review');
  });
});
