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
});
