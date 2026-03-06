const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fsp = require('node:fs/promises');

const { TaskRunner } = require('../agent/core/task-runner');

describe('TaskRunner', () => {
  let tmpDir;
  let configs;
  let published;
  let board;

  beforeEach(async () => {
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'task-runner-'));
    configs = new Map();
    published = [];

    board = {
      client: { isOpen: true },
      disconnect: async () => {},
      setConfig: async (key, value) => {
        configs.set(key, value);
      },
      getConfig: async (key) => configs.get(key) || null,
      listConfigs: async (prefix) => {
        return [...configs.entries()]
          .filter(([key]) => key.startsWith(prefix))
          .map(([key, value]) => ({ key, value }));
      },
      batchPublish: async (entries) => {
        published.push(...entries);
        return { count: entries.length };
      },
      publish: async (channel, data) => {
        published.push({ channel, data });
      },
    };
  });

  it('creates deterministic workspace state and publishes start events', async () => {
    const runner = new TaskRunner({ board, workspaceRoot: tmpDir });
    await runner.init();

    const state = await runner.startTask({
      author: 'codex',
      projectId: 'kingdom:core',
      taskId: 'TASK-42',
      goal: 'Implement task lifecycle runner',
      skillsToEvaluate: ['verify-tests'],
      reviewArtifacts: [{ file: 'docs/task-runner.md', summary: 'Task runner notes' }],
    });

    assert.match(state.workspacePath, /workspace|task-runner-/);
    assert.equal(state.status, 'started');
    assert.deepEqual(state.skillsToEvaluate, ['verify-tests']);
    assert.equal(state.reviewArtifacts[0].file, 'docs/task-runner.md');
    assert.equal(configs.get('tasks:kingdom:core:TASK-42').status, 'started');
    assert.equal(published[0].channel, 'work:task:started');
    assert.equal(published[1].channel, 'execution:task:workspace-ready');

    const stat = await fsp.stat(state.workspacePath);
    assert.equal(stat.isDirectory(), true);
  });

  it('completes a task only with verification evidence', async () => {
    const runner = new TaskRunner({ board, workspaceRoot: tmpDir });
    await runner.init();
    await runner.startTask({
      author: 'codex',
      projectId: 'kingdom',
      taskId: 'TASK-7',
      goal: 'Keep verification attached to closeout',
    });

    const completed = await runner.completeTask({
      author: 'codex',
      projectId: 'kingdom',
      taskId: 'TASK-7',
      verification: ['npm test', 'npm run lint'],
    });

    assert.equal(completed.status, 'completed');
    assert.equal(completed.verification.length, 2);
    assert.equal(published.at(-1).channel, 'governance:task:completed');
    assert.equal(published.at(-1).data.verificationCount, 2);
  });

  it('rejects completion without verification evidence', async () => {
    const runner = new TaskRunner({ board, workspaceRoot: tmpDir });
    await runner.init();

    await assert.rejects(() => runner.completeTask({
      author: 'codex',
      projectId: 'kingdom',
      taskId: 'TASK-9',
      verification: [],
    }), /verification evidence is required/);
  });

  it('records failure state and emits retry request', async () => {
    const runner = new TaskRunner({ board, workspaceRoot: tmpDir });
    await runner.init();
    await runner.startTask({
      author: 'codex',
      projectId: 'kingdom',
      taskId: 'TASK-11',
      goal: 'Handle failure cleanly',
    });

    const failed = await runner.failTask({
      author: 'codex',
      projectId: 'kingdom',
      taskId: 'TASK-11',
      category: 'test',
      guardrail: 'keep-green',
    });

    assert.equal(failed.status, 'failed');
    assert.equal(failed.failure.category, 'test');
    assert.equal(published.at(-1).channel, 'governance:failure:retry-requested');
    assert.equal(published.at(-1).data.guardrail, 'keep-green');
  });

  it('tracks review and retry lifecycle state on an existing task', async () => {
    const runner = new TaskRunner({ board, workspaceRoot: tmpDir });
    await runner.init();
    await runner.startTask({
      author: 'codex',
      projectId: 'kingdom',
      taskId: 'TASK-12',
      goal: 'Track lifecycle state',
    });

    const requested = await runner.markReviewRequested({
      projectId: 'kingdom',
      taskId: 'TASK-12',
      file: 'docs/lifecycle.md',
    });
    assert.equal(requested.review.status, 'requested');

    const rejected = await runner.markReviewRejected({
      projectId: 'kingdom',
      taskId: 'TASK-12',
      file: 'docs/lifecycle.md',
      feedback: 'needs stronger verification',
    });
    assert.equal(rejected.status, 'changes_requested');
    assert.equal(rejected.review.feedback, 'needs stronger verification');

    const retried = await runner.markRetryRequested({
      projectId: 'kingdom',
      taskId: 'TASK-12',
      category: 'review',
      guardrail: 'verification-gap',
    });
    assert.equal(retried.status, 'retry_requested');
    assert.equal(retried.retry.count, 1);

    const approved = await runner.markReviewApproved({
      projectId: 'kingdom',
      taskId: 'TASK-12',
      file: 'docs/lifecycle.md',
    });
    assert.equal(approved.status, 'approved');
    assert.equal(approved.review.status, 'approved');
  });

  it('lists stored tasks in reverse updated order', async () => {
    const runner = new TaskRunner({ board, workspaceRoot: tmpDir });
    await runner.init();
    await runner.startTask({
      author: 'codex',
      projectId: 'kingdom',
      taskId: 'TASK-21',
      goal: 'First task',
    });
    await runner.startTask({
      author: 'codex',
      projectId: 'kingdom',
      taskId: 'TASK-22',
      goal: 'Second task',
    });

    const tasks = await runner.listTasks({ projectId: 'kingdom' });
    assert.equal(tasks.length, 2);
    assert.equal(tasks[0].taskId, 'TASK-22');
    assert.equal(tasks[1].taskId, 'TASK-21');
  });

  it('filters stored tasks by retry metadata and explicit identifiers', async () => {
    const runner = new TaskRunner({ board, workspaceRoot: tmpDir });
    await runner.init();
    await runner.startTask({
      author: 'codex',
      projectId: 'kingdom',
      taskId: 'TASK-31',
      goal: 'Retry task',
    });
    await runner.startTask({
      author: 'codex',
      projectId: 'kingdom',
      taskId: 'TASK-32',
      goal: 'Stable task',
    });

    await runner.markRetryRequested({
      projectId: 'kingdom',
      taskId: 'TASK-31',
      category: 'review',
      guardrail: 'verification-gap',
    });
    await runner.markReviewApproved({
      projectId: 'kingdom',
      taskId: 'TASK-32',
      file: 'docs/stable.md',
    });

    const byGuardrail = await runner.listTasks({
      projectId: 'kingdom',
      retryGuardrail: 'verification-gap',
    });
    assert.deepEqual(byGuardrail.map((task) => task.taskId), ['TASK-31']);

    const byCategory = await runner.listTasks({
      retryCategory: 'review',
    });
    assert.deepEqual(byCategory.map((task) => task.taskId), ['TASK-31']);

    const byStatus = await runner.listTasks({
      projectId: 'kingdom',
      status: 'approved',
    });
    assert.deepEqual(byStatus.map((task) => task.taskId), ['TASK-32']);

    const byTaskId = await runner.listTasks({
      projectId: 'kingdom',
      taskId: 'TASK-31',
    });
    assert.deepEqual(byTaskId.map((task) => task.taskId), ['TASK-31']);
  });

  it('records dry-run evidence before completion and emits a dry-run event', async () => {
    const runner = new TaskRunner({ board, workspaceRoot: tmpDir });
    await runner.init();
    await runner.startTask({
      author: 'codex',
      projectId: 'kingdom',
      taskId: 'TASK-41',
      goal: 'Rehearse before implementation',
    });

    const updated = await runner.recordDryRun({
      author: 'codex',
      projectId: 'kingdom',
      taskId: 'TASK-41',
      summary: 'Validated retry path with a simulated rejection flow',
      verification: ['simulated review reject', 'simulated retry handoff'],
      outcome: 'passed',
    });

    assert.equal(updated.dryRuns.length, 1);
    assert.equal(updated.dryRuns[0].summary, 'Validated retry path with a simulated rejection flow');
    assert.equal(updated.dryRuns[0].outcome, 'passed');
    assert.equal(published.at(-1).channel, 'work:dry-run:recorded');
    assert.equal(published.at(-1).data.taskId, 'TASK-41');
  });

  it('shutdown disconnects board when client is open', async () => {
    let disconnected = false;
    board.disconnect = async () => { disconnected = true; };
    const runner = new TaskRunner({ board, workspaceRoot: tmpDir });
    await runner.init();

    await runner.shutdown();
    assert.equal(disconnected, true);
  });

  it('shutdown is safe when board is already closed', async () => {
    board.disconnect = async () => {};
    board.client = { isOpen: false };
    const runner = new TaskRunner({ board, workspaceRoot: tmpDir });

    // Should not throw
    await runner.shutdown();
  });

  it('_patchTaskState increments _version on each mutation', async () => {
    const runner = new TaskRunner({ board, workspaceRoot: tmpDir });
    await runner.init();
    await runner.startTask({
      author: 'codex',
      projectId: 'kingdom',
      taskId: 'TASK-VER',
      goal: 'Version tracking',
    });

    const afterStart = configs.get('tasks:kingdom:TASK-VER');
    assert.equal(afterStart._version, 0);

    await runner.markReviewRequested({
      projectId: 'kingdom',
      taskId: 'TASK-VER',
      file: 'docs/ver.md',
    });

    const afterReview = configs.get('tasks:kingdom:TASK-VER');
    assert.equal(afterReview._version, 1);

    await runner.markReviewApproved({
      projectId: 'kingdom',
      taskId: 'TASK-VER',
      file: 'docs/ver.md',
    });

    const afterApprove = configs.get('tasks:kingdom:TASK-VER');
    assert.equal(afterApprove._version, 2);
  });
});
