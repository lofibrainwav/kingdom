const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fsp = require('node:fs/promises');

const { TaskRunner } = require('../agent/core/task-runner');
const { TaskCloseoutOrchestrator } = require('../agent/core/task-closeout-orchestrator');
const { SkillEvaluator } = require('../agent/core/skill-evaluator');
const { KnowledgeOperator } = require('../agent/memory/knowledge-operator');

describe('TaskCloseoutOrchestrator', () => {
  let workspaceRoot;
  let vaultDir;
  let skillsRoot;
  let configs;
  let published;
  let subscriptions;
  let board;

  beforeEach(async () => {
    workspaceRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'closeout-workspace-'));
    vaultDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'closeout-vault-'));
    skillsRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'closeout-skills-'));
    await fsp.mkdir(path.join(skillsRoot, 'demo-skill'), { recursive: true });
    await fsp.writeFile(path.join(skillsRoot, 'demo-skill', 'SKILL.md'), `---
name: demo-skill
description: Use when testing the closeout orchestrator skill evaluation flow.
---

# Demo Skill

## When to Use

- End-to-end closeout tests need a valid skill

## Implementation

- Keep the structure valid so the evaluator passes.
`, 'utf8');

    configs = new Map();
    published = [];
    subscriptions = new Map();

    board = {
      client: { isOpen: true },
      connect: async () => {},
      disconnect: async () => {},
      setConfig: async (key, value) => {
        configs.set(key, value);
      },
      getConfig: async (key) => configs.get(key) || null,
      updateStatus: async () => {},
      batchPublish: async (entries) => {
        for (const entry of entries) {
          await board.publish(entry.channel, entry.data);
        }
      },
      publish: async (channel, data) => {
        published.push({ channel, data });
        const handlers = subscriptions.get(channel) || [];
        for (const handler of handlers) {
          await handler(data);
        }
      },
      createSubscriber: async () => ({
        on: () => {},
        subscribe: async (channel, handler) => {
          const handlers = subscriptions.get(channel) || [];
          handlers.push(handler);
          subscriptions.set(channel, handlers);
        },
        disconnect: async () => {},
      }),
    };
  });

  it('orchestrates review request, skill evaluation, and knowledge capture after task completion', async () => {
    const runner = new TaskRunner({ board, workspaceRoot });
    const evaluator = new SkillEvaluator({ board, skillsRoot });
    const closeout = new TaskCloseoutOrchestrator({ board, skillEvaluator: evaluator });
    const knowledge = new KnowledgeOperator({
      board,
      vaultDir,
      writePattern: async () => null,
      addDashboardLink: async () => {},
    });

    await runner.init();
    await closeout.init();
    await knowledge.init();
    await closeout.start();
    await knowledge.start();

    const reviewerSub = await board.createSubscriber();
    await reviewerSub.subscribe('governance:review:requested', async (payload) => {
      await board.publish('governance:review:approved', {
        projectId: payload.projectId,
        taskId: payload.taskId,
        file: payload.file,
      });
    });

    await runner.startTask({
      author: 'codex',
      projectId: 'kingdom',
      taskId: 'TASK-77',
      goal: 'Close the full loop',
      skillsToEvaluate: ['demo-skill'],
      reviewArtifacts: [{ file: 'docs/loop.md', summary: 'Loop summary' }],
    });

    await runner.completeTask({
      author: 'codex',
      projectId: 'kingdom',
      taskId: 'TASK-77',
      verification: ['npm test', 'npm run lint'],
    });

    const channels = published.map((entry) => entry.channel);
    assert.ok(channels.includes('governance:task:completed'));
    assert.ok(channels.includes('governance:review:requested'));
    assert.ok(channels.includes('governance:review:approved'));
    assert.ok(channels.includes('knowledge:skill:eval-completed'));

    const captures = published.filter((entry) => entry.channel === 'knowledge:capture:stored');
    const captureTitles = captures.map((entry) => entry.data.title).sort();
    assert.deepEqual(captureTitles, [
      'Approved TASK-77',
      'Completed TASK-77',
      'Skill eval demo-skill',
    ]);

    const notes = await fsp.readdir(vaultDir);
    assert.ok(notes.includes('approved-task-77.md'));
    assert.ok(notes.includes('completed-task-77.md'));
    assert.ok(notes.includes('skill-eval-demo-skill.md'));

    const finalState = configs.get('tasks:kingdom:TASK-77');
    assert.equal(finalState.review.status, 'approved');
    assert.equal(finalState.status, 'approved');
    assert.equal(finalState.review.file, 'docs/loop.md');
  });

  it('tracks rejected reviews and retry requests back into task state', async () => {
    const runner = new TaskRunner({ board, workspaceRoot });
    const evaluator = new SkillEvaluator({ board, skillsRoot });
    const closeout = new TaskCloseoutOrchestrator({ board, skillEvaluator: evaluator, taskRunner: runner });

    await runner.init();
    await closeout.init();
    await closeout.start();

    await runner.startTask({
      author: 'codex',
      projectId: 'kingdom',
      taskId: 'TASK-88',
      goal: 'Handle rejected closeout',
      skillsToEvaluate: ['demo-skill'],
      reviewArtifacts: [{ file: 'docs/reject.md', summary: 'Reject summary' }],
    });

    await runner.completeTask({
      author: 'codex',
      projectId: 'kingdom',
      taskId: 'TASK-88',
      verification: ['npm test'],
    });

    await board.publish('governance:review:rejected', {
      projectId: 'kingdom',
      taskId: 'TASK-88',
      file: 'docs/reject.md',
      feedback: 'needs stronger test evidence',
    });

    await board.publish('governance:failure:retry-requested', {
      author: 'failure-agent',
      projectId: 'kingdom',
      taskId: 'TASK-88',
      category: 'review',
      guardrail: 'verification-gap',
    });

    const finalState = configs.get('tasks:kingdom:TASK-88');
    assert.equal(finalState.review.status, 'rejected');
    assert.equal(finalState.review.feedback, 'needs stronger test evidence');
    assert.equal(finalState.status, 'retry_requested');
    assert.equal(finalState.retry.guardrail, 'verification-gap');
    assert.equal(finalState.retry.count, 1);
  });

  it('hands retry-requested tasks back into work intake with deterministic metadata', async () => {
    const runner = new TaskRunner({ board, workspaceRoot });
    const evaluator = new SkillEvaluator({ board, skillsRoot });
    const closeout = new TaskCloseoutOrchestrator({ board, skillEvaluator: evaluator, taskRunner: runner });

    await runner.init();
    await closeout.init();
    await closeout.start();

    await runner.startTask({
      author: 'codex',
      projectId: 'kingdom',
      taskId: 'TASK-99',
      goal: 'Retry handoff should re-enter intake',
      reviewArtifacts: [{ file: 'docs/retry.md', summary: 'Retry summary' }],
    });

    await board.publish('governance:failure:retry-requested', {
      author: 'failure-agent',
      projectId: 'kingdom',
      taskId: 'TASK-99',
      category: 'review',
      guardrail: 'missing-evidence',
    });

    const intakeEvent = published.find((entry) => entry.channel === 'work:intake');
    assert.ok(intakeEvent);
    assert.equal(intakeEvent.data.author, 'failure-agent');
    assert.equal(intakeEvent.data.projectId, 'kingdom');
    assert.equal(intakeEvent.data.taskId, 'TASK-99');
    assert.equal(intakeEvent.data.retry, true);
    assert.match(intakeEvent.data.task, /Retry TASK-99/);

    const finalState = configs.get('tasks:kingdom:TASK-99');
    assert.equal(finalState.status, 'retry_requested');
    assert.equal(finalState.retry.handoff.status, 'queued');
    assert.equal(finalState.retry.handoff.channel, 'work:intake');
  });
});
