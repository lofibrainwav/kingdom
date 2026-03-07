/**
 * Vault Sync tests.
 * Tests Dashboard.md and Session-Sync.md auto-update logic using fsp mocks.
 */
const { describe, it, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('fs').promises;

const {
  gatherStats,
  syncDashboard,
  syncSessionState,
  writePattern,
  addDashboardLink,
  VaultAgent,
  DASHBOARD_PATH,
  SESSION_SYNC_PATH
} = require('../agent/memory/vault-sync');

const DASHBOARD_TEMPLATE = `---
tags: [dashboard]
---

## System Vitals

> > [!stat] TESTS
> > <div style="font-size: 2em; font-weight: bold; color: #3fb950;">408</div>
> > <span style="font-size: 0.8em; color: gray;">404 PASS | 0 FAIL | 4 SKIP</span>

## Claude Session State

| Field | Value |
|-------|-------|
| **Last Session** | 2026-03-04 |
| **Last Commit** | \`abc1234\` old msg |
| **Test Count** | 408 (404 pass, 0 fail, 4 skip) |
| **Branch** | \`main\` |

<p>Last Synced: <strong>2026-03-04</strong> | 408 Tests</p>

<!-- INDEX:Recent Achievements -->

<!-- INDEX:Learning Wall -->
`;

const SESSION_SYNC_TEMPLATE = `---
tags: [session]
---

## Current State

| Field | Value |
|-------|-------|
| **Session Date** | 2026-03-04 |
| **Last Commit** | \`abc1234\` — old msg |
| **Tests** | 408 total (404 pass, 0 fail, 4 skip) |
| **Lint** | 0 errors |
| **Branch** | \`main\` |
`;

describe('vault-sync — gatherStats', () => {
  it('returns stats object with correct fields', () => {
    const stats = gatherStats();
    assert.ok(stats.date);
    assert.equal(typeof stats.lastCommit, 'string');
    assert.equal(typeof stats.branch, 'string');
    assert.equal(typeof stats.tests, 'number');
  });

  it('returns today date', () => {
    const stats = gatherStats();
    const today = new Date().toISOString().slice(0, 10);
    assert.equal(stats.date, today);
  });
});

describe('vault-sync — syncDashboard', () => {
  let writtenData = {};

  beforeEach(() => {
    writtenData = {};
    mock.method(fsp, 'readFile', async (filepath) => {
      if (filepath.includes('Dashboard.md')) return DASHBOARD_TEMPLATE;
      throw new Error(`File not found: ${filepath}`);
    });
    mock.method(fsp, 'writeFile', async (filepath, data) => {
      writtenData[filepath] = data;
    });
  });

  afterEach(() => {
    mock.restoreAll();
  });

  it('updates dashboard stat cards and session table', async () => {
    const stats = {
      tests: 454,
      pass: 451,
      fail: 0,
      skip: 3,
      date: '2026-03-05',
      lastCommit: 'xyz789',
      commitMsg: 'new msg',
      branch: 'main'
    };

    const changed = await syncDashboard(stats);
    assert.equal(changed, true);

    const content = writtenData[DASHBOARD_PATH];
    assert.ok(content, 'Dashboard should have been written');
    
    // Check TESTS stat card
    assert.ok(content.includes('454</div>'));
    assert.ok(content.includes('451 PASS | 0 FAIL | 3 SKIP'));

    // Check generic fields
    assert.ok(content.includes('2026-03-05 |'));
    assert.ok(content.includes('\`xyz789\` new msg |'));
    assert.ok(content.includes('454 (451 pass, 0 fail, 3 skip) |'));
    assert.ok(content.includes('Last Synced: <strong>2026-03-05</strong> | 454 Tests'));
  });

  it('returns false and logs error on file access failure', async () => {
    // Override readFile to throw
    mock.restoreAll();
    mock.method(fsp, 'readFile', async () => { throw new Error('EACCES'); });
    
    const changed = await syncDashboard({ tests: 1, pass: 1, fail: 0, skip: 0 });
    assert.equal(changed, false);
  });
});

describe('vault-sync — syncSessionState', () => {
  let writtenData = {};

  beforeEach(() => {
    writtenData = {};
    mock.method(fsp, 'readFile', async (filepath) => {
      if (filepath.includes('Session-Sync.md')) return SESSION_SYNC_TEMPLATE;
      throw new Error('Not found');
    });
    mock.method(fsp, 'writeFile', async (filepath, data) => {
      writtenData[filepath] = data;
    });
  });

  afterEach(() => {
    mock.restoreAll();
  });

  it('updates session state table correctly', async () => {
    const session = {
      tests: 460,
      pass: 457,
      fail: 0,
      skip: 3,
      date: '2026-03-05',
      lastCommit: 'def456',
      commitMsg: 'new commit msg',
      branch: 'feature-branch',
      lint: 2
    };

    const changed = await syncSessionState(session);
    assert.equal(changed, true);

    const content = writtenData[SESSION_SYNC_PATH];
    assert.ok(content);
    assert.ok(content.includes(' 2026-03-05 |'));
    assert.ok(content.includes('\`def456\` — new commit msg |'));
    assert.ok(content.includes('460 total (457 pass, 0 fail, 3 skip) |'));
    assert.ok(content.includes('2 errors |'));
    assert.ok(content.includes('\`feature-branch\` |'));
  });
});

describe('vault-sync — writePattern & addDashboardLink', () => {
  let writtenData = {};
  let dirsCreated = [];

  beforeEach(() => {
    writtenData = {};
    dirsCreated = [];
    mock.method(fsp, 'readFile', async () => {
      return DASHBOARD_TEMPLATE;
    });
    mock.method(fsp, 'writeFile', async (filepath, data) => {
      writtenData[filepath] = data;
    });
    mock.method(fsp, 'mkdir', async (dir) => {
      dirsCreated.push(dir);
    });
  });

  afterEach(() => {
    mock.restoreAll();
  });

  it('writePattern writes markdown to vault/patterns', async () => {
    const p = await writePattern('Test Pattern 123', '# Some Content');
    assert.ok(p.endsWith('Test-Pattern-123.md'));
    assert.ok(dirsCreated.some(dir => dir.endsWith('patterns')));
    assert.equal(writtenData[p], '# Some Content');
  });

  it('addDashboardLink appends link under INDEX:section', async () => {
    await addDashboardLink('Recent Achievements', '[[Some Note]] - Cool thing');
    const content = writtenData[DASHBOARD_PATH];
    assert.equal(typeof content, 'string', 'Dashboard content should be a string');
    assert.equal(content.includes('<!-- INDEX:Recent Achievements -->\n- [[Some Note]] - Cool thing'), true, 'should contain appended link under section');
  });
});

describe('vault-sync — VaultAgent', () => {
  let writtenData = {};
  
  beforeEach(() => {
    writtenData = {};
    mock.method(fsp, 'readFile', async () => DASHBOARD_TEMPLATE);
    mock.method(fsp, 'writeFile', async (filepath, data) => { writtenData[filepath] = data; });
  });

  afterEach(() => {
    mock.restoreAll();
  });

  it('handleApproval adds a link to Dashboard', async () => {
    const agent = new VaultAgent();
    // Use dummy board just so we can test handleApproval manually
    // Since handleApproval relies on addDashboardLink, it uses the global DASHBOARD_PATH
    await agent.handleApproval({ projectId: 'ProjX', taskId: 'T-123', file: 'x.js' });
    
    const content = writtenData[DASHBOARD_PATH];
    assert.equal(typeof content, 'string', 'Dashboard should have been updated by handleApproval');
    assert.equal(content.includes('[[ProjX]] - Task T-123 approved in x.js'), true, 'should contain approval link');
  });

  it('handleFailure adds a link to Dashboard', async () => {
    const agent = new VaultAgent();
    await agent.handleFailure({ projectId: 'ProjY', taskId: 'T-999', category: 'lint', guardrail: 'no-console' });
    
    const content = writtenData[DASHBOARD_PATH];
    assert.equal(typeof content, 'string', 'Dashboard should have been updated by handleFailure');
    assert.equal(content.includes('[[ProjY]] - lint failure on T-999. Guardrail: \`no-console\`'), true, 'should contain failure link');
  });

  it('shutdown disconnects subscriber and board', async () => {
    let subDisconnected = false;
    let boardDisconnected = false;
    const mockBoard = {
      createSubscriber: async () => ({
        on: () => {},
        subscribe: async () => {},
        disconnect: async () => { subDisconnected = true; },
      }),
      disconnect: async () => { boardDisconnected = true; },
    };

    const agent = new VaultAgent();
    await agent.init(mockBoard);
    await agent.shutdown();

    assert.equal(subDisconnected, true, 'subscriber should be disconnected');
    assert.equal(boardDisconnected, true, 'board should be disconnected');
  });

  it('init wires up Redis subscriber correctly', async () => {
    let _onCb, _subscrParams = {};
    const mockBoard = {
      createSubscriber: async () => ({
        on: (event, cb) => { _onCb = cb; },
        subscribe: async (channel, handler) => { _subscrParams[channel] = handler; }
      })
    };

    const agent = new VaultAgent();
    await agent.init(mockBoard);

    assert.equal(typeof _onCb, 'function');
    assert.equal(typeof _subscrParams['governance:review:approved'], 'function');
    assert.equal(typeof _subscrParams['governance:failure:retry-requested'], 'function');

    // Simulate event
    await _subscrParams['governance:review:approved']({ projectId: 'ProjString', taskId: 'T-ABC', file: 'y.mjs' });
    
    const content = writtenData[DASHBOARD_PATH];
    assert.ok(content);
    assert.ok(content.includes('[[ProjString]] - Task T-ABC approved'));
  });
});

describe('vault-sync — generic error fallback', () => {
  it('returns false and logs error on catch', async () => {
    // lines 166-168
    const { syncSessionState } = require('../agent/memory/vault-sync');
    const fsp = require('fs').promises;
    mock.method(fsp, 'readFile', async () => { throw new Error('mock read error'); });
    const result = await syncSessionState({});
    assert.equal(result, false);
    mock.restoreAll();
  });

  it('suppresses and logs errors gracefully in addDashboardLink', async () => {
    // lines 200-201
    const { addDashboardLink } = require('../agent/memory/vault-sync');
    const fsp = require('fs').promises;
    mock.method(fsp, 'readFile', async () => { throw new Error('mock err'); });
    await assert.doesNotReject(() => addDashboardLink('Recent', 'link[]'));
    mock.restoreAll();
  });
});
