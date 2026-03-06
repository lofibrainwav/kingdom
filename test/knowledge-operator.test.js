const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fsp = require('node:fs/promises');

const { KnowledgeOperator } = require('../agent/memory/knowledge-operator');

describe('KnowledgeOperator', () => {
  let tmpDir;
  let published;
  let dashboardLinks;
  let patterns;
  let createdSkills;
  let board;
  let zk;
  let configs;

  beforeEach(async () => {
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'knowledge-operator-'));
    published = [];
    dashboardLinks = [];
    patterns = [];
    createdSkills = [];
    configs = new Map();

    board = {
      client: { isOpen: true },
      publish: async (channel, data) => {
        published.push({ channel, data });
      },
      setConfig: async (key, value) => {
        configs.set(key, value);
      },
      getConfig: async (key) => configs.get(key) || null,
      createSubscriber: async () => ({
        on: () => {},
        subscribe: async () => {},
      }),
    };

    zk = {
      _slugify: (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
      getNote: async () => null,
      createNote: async (data) => {
        createdSkills.push(data);
        return { id: data.name };
      },
    };
  });

  it('captures a milestone into the vault, pattern registry, zettelkasten, and blackboard', async () => {
    const operator = new KnowledgeOperator({
      board,
      zettelkasten: zk,
      vaultDir: tmpDir,
      writePattern: async (name, content) => {
        patterns.push({ name, content });
        return `/vault/patterns/${name}.md`;
      },
      addDashboardLink: async (section, link) => {
        dashboardLinks.push({ section, link });
      },
    });

    await operator.init();
    const result = await operator.capture({
      author: 'codex',
      projectId: 'kingdom',
      title: 'Canonical knowledge loop',
      summary: 'Validated the first runtime knowledge ingestion path.',
      outcome: 'passed',
      verification: ['npm test (191 pass)', 'npm audit (0 vulnerabilities)'],
      lesson: 'Knowledge capture should produce a durable note and a reusable pattern.',
      pattern: {
        name: 'Knowledge Capture Bundle',
        summary: 'Store note, verification, and pattern together.',
      },
      skill: {
        name: 'Knowledge Capture Bundle',
        description: 'Bundle milestone evidence into reusable memory artifacts.',
        errorType: 'workflow:knowledge-capture',
        code: 'capture({ verification, lesson, pattern })',
      },
      tags: ['knowledge', 'operator-loop'],
    });

    const stored = await fsp.readFile(result.notePath, 'utf-8');

    assert.match(result.notePath, /canonical-knowledge-loop\.md$/);
    assert.match(stored, /# Canonical knowledge loop/);
    assert.match(stored, /Validated the first runtime knowledge ingestion path\./);
    assert.match(stored, /npm test \(191 pass\)/);
    assert.equal(result.patternPath, '/vault/patterns/Knowledge Capture Bundle.md');
    assert.equal(result.skillNoteId, 'knowledge-capture-bundle');
    assert.equal(createdSkills.length, 1);
    assert.equal(patterns.length, 1);
    assert.equal(dashboardLinks[0].section, 'Recent Achievements');
    assert.equal(published.length, 1);
    assert.equal(published[0].channel, 'knowledge:capture:stored');
    assert.equal(published[0].data.projectId, 'kingdom');
    assert.equal(published[0].data.outcome, 'passed');
  });

  it('rejects incomplete bundles before writing artifacts', async () => {
    const operator = new KnowledgeOperator({
      board,
      zettelkasten: zk,
      vaultDir: tmpDir,
      writePattern: async () => '/tmp/pattern.md',
      addDashboardLink: async () => {},
    });

    await operator.init();

    await assert.rejects(() => operator.capture({
      author: 'codex',
      projectId: 'kingdom',
      title: 'Incomplete capture',
      summary: 'Missing verification should fail.',
      outcome: 'passed',
      verification: [],
      lesson: 'No lesson without evidence.',
    }), /verification evidence is required/);

    const files = await fsp.readdir(tmpDir);
    assert.equal(files.length, 0);
    assert.equal(published.length, 0);
  });

  it('subscribes to review approval and failure retry events with auto-capture handlers', async () => {
    const subscriptions = {};
    board.createSubscriber = async () => ({
      on: () => {},
      subscribe: async (channel, handler) => {
        subscriptions[channel] = handler;
      },
    });

    const operator = new KnowledgeOperator({
      board,
      zettelkasten: zk,
      vaultDir: tmpDir,
      writePattern: async (name) => `/vault/patterns/${name}.md`,
      addDashboardLink: async (section, link) => {
        dashboardLinks.push({ section, link });
      },
    });

    await operator.init();
    await operator.start();

    assert.equal(typeof subscriptions['governance:review:approved'], 'function');
    assert.equal(typeof subscriptions['governance:failure:retry-requested'], 'function');
    assert.equal(typeof subscriptions['governance:task:completed'], 'function');
    assert.equal(typeof subscriptions['knowledge:skill:eval-completed'], 'function');

    await subscriptions['governance:review:approved']({
      projectId: 'kingdom',
      taskId: 'TASK-1',
      file: 'agent/core/blackboard.js',
    });
    await subscriptions['governance:failure:retry-requested']({
      projectId: 'kingdom',
      taskId: 'TASK-2',
      category: 'test',
      guardrail: 'keep-green',
    });

    assert.equal(published.length, 2);
    assert.equal(published[0].data.outcome, 'passed');
    assert.equal(published[1].data.outcome, 'failed');
    assert.equal(dashboardLinks[0].section, 'Recent Achievements');
    assert.equal(dashboardLinks[1].section, 'Learning Wall');
  });

  it('captures completed task events using stored task state when available', async () => {
    const subscriptions = {};
    board.getConfig = async () => ({
      goal: 'Close the loop',
      workspacePath: '/tmp/kingdom/TASK-3',
      verification: ['npm test', 'npm run lint'],
      dryRuns: [
        {
          summary: 'Simulated closeout before final run',
          verification: ['dry-run review request'],
          outcome: 'passed',
        },
      ],
    });
    board.createSubscriber = async () => ({
      on: () => {},
      subscribe: async (channel, handler) => {
        subscriptions[channel] = handler;
      },
    });

    const operator = new KnowledgeOperator({
      board,
      zettelkasten: zk,
      vaultDir: tmpDir,
      writePattern: async (name) => `/vault/patterns/${name}.md`,
      addDashboardLink: async (section, link) => {
        dashboardLinks.push({ section, link });
      },
    });

    await operator.init();
    await operator.start();
    await subscriptions['governance:task:completed']({
      author: 'codex',
      projectId: 'kingdom',
      taskId: 'TASK-3',
      verificationCount: 2,
    });

    assert.equal(published.length, 1);
    assert.equal(published[0].channel, 'knowledge:capture:stored');
    assert.equal(published[0].data.title, 'Completed TASK-3');
    assert.equal(dashboardLinks[0].section, 'Recent Achievements');

    const notePath = path.join(tmpDir, 'completed-task-3.md');
    const note = await fsp.readFile(notePath, 'utf-8');
    assert.match(note, /Simulated closeout before final run/);
  });

  it('captures retry resolution context when a completed task closes a previous guardrail', async () => {
    const subscriptions = {};
    board.getConfig = async () => ({
      goal: 'Recover verification gap',
      workspacePath: '/tmp/kingdom/TASK-9',
      verification: ['npm test', 'npm run lint'],
      retry: {
        category: 'review',
        guardrail: 'missing-evidence',
        count: 2,
      },
    });
    board.createSubscriber = async () => ({
      on: () => {},
      subscribe: async (channel, handler) => {
        subscriptions[channel] = handler;
      },
    });

    const operator = new KnowledgeOperator({
      board,
      zettelkasten: zk,
      vaultDir: tmpDir,
      writePattern: async (name) => `/vault/patterns/${name}.md`,
      addDashboardLink: async (section, link) => {
        dashboardLinks.push({ section, link });
      },
    });

    await operator.init();
    await operator.start();
    await subscriptions['governance:task:completed']({
      author: 'codex',
      projectId: 'kingdom',
      taskId: 'TASK-9',
      verificationCount: 2,
    });

    assert.equal(published.length, 1);
    assert.equal(published[0].data.retryCategory, 'review');
    assert.equal(published[0].data.retryGuardrail, 'missing-evidence');
    assert.match(published[0].data.improvementNote, /Resolved guardrail missing-evidence/);

    const notePath = path.join(tmpDir, 'completed-task-9.md');
    const note = await fsp.readFile(notePath, 'utf-8');
    assert.match(note, /## Improvement/);
    assert.match(note, /Resolved guardrail missing-evidence/);
  });

  it('stores the latest task capture summary as indexed config for dashboard joins', async () => {
    const subscriptions = {};
    board.getConfig = async () => ({
      goal: 'Link task knowledge',
      workspacePath: '/tmp/kingdom/TASK-14',
      verification: ['npm test'],
      retry: {
        category: 'review',
        guardrail: 'missing-lesson',
        count: 1,
      },
    });
    board.createSubscriber = async () => ({
      on: () => {},
      subscribe: async (channel, handler) => {
        subscriptions[channel] = handler;
      },
    });

    const operator = new KnowledgeOperator({
      board,
      zettelkasten: zk,
      vaultDir: tmpDir,
      writePattern: async (name) => `/vault/patterns/${name}.md`,
      addDashboardLink: async () => {},
    });

    await operator.init();
    await operator.start();
    await subscriptions['governance:task:completed']({
      author: 'codex',
      projectId: 'kingdom',
      taskId: 'TASK-14',
      verificationCount: 1,
    });

    const latest = configs.get('knowledge:task:kingdom:TASK-14:latest');
    assert.ok(latest);
    assert.equal(latest.projectId, 'kingdom');
    assert.equal(latest.taskId, 'TASK-14');
    assert.equal(latest.outcome, 'passed');
    assert.match(latest.improvementNote, /Resolved guardrail missing-lesson/);
  });

  it('captures skill evaluation events into durable knowledge notes', async () => {
    const subscriptions = {};
    board.createSubscriber = async () => ({
      on: () => {},
      subscribe: async (channel, handler) => {
        subscriptions[channel] = handler;
      },
    });

    const operator = new KnowledgeOperator({
      board,
      zettelkasten: zk,
      vaultDir: tmpDir,
      writePattern: async (name) => `/vault/patterns/${name}.md`,
      addDashboardLink: async (section, link) => {
        dashboardLinks.push({ section, link });
      },
    });

    await operator.init();
    await operator.start();
    await subscriptions['knowledge:skill:eval-completed']({
      author: 'skill-evaluator',
      skillName: 'verify-tests',
      score: 100,
      findingCount: 0,
      passed: true,
    });

    assert.equal(published.length, 1);
    assert.equal(published[0].channel, 'knowledge:capture:stored');
    assert.equal(published[0].data.projectId, 'skills');
    assert.equal(published[0].data.title, 'Skill eval verify-tests');
    assert.equal(dashboardLinks[0].section, 'Recent Achievements');
  });
});
