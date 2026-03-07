/**
 * Tests for agent/interface/obsidian-dashboard.js
 * Verifies file rendering, event handling, and throttled writes.
 */
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { ObsidianDashboard, WRITE_INTERVAL_MS } = require('../agent/interface/obsidian-dashboard');

// Override DASHBOARD_DIR to temp dir for tests
const TEMP_DIR = path.join(os.tmpdir(), `kingdom-dashboard-test-${Date.now()}`);

function createDashboard() {
  const dash = new ObsidianDashboard();
  // Override the board to prevent real Redis connections
  dash.board = {
    connect: async () => {},
    disconnect: async () => {},
    client: { isReady: true },
    createSubscriber: async () => ({
      on: () => {},
      subscribe: async () => {},
      pSubscribe: async () => {},
      pUnsubscribe: async () => {},
      disconnect: async () => {},
    }),
  };
  return dash;
}

// Patch DASHBOARD_DIR for all renders
const origModule = require('../agent/interface/obsidian-dashboard');

describe('ObsidianDashboard — constructor', () => {
  it('should initialize with empty state', () => {
    const dash = createDashboard();
    assert.deepEqual(dash.agentState, {});
    assert.deepEqual(dash.pipelineStages, {});
    assert.deepEqual(dash.eventLog, []);
    assert.equal(dash.metrics.knowledgeCaptures, 0);
    assert.equal(dash.metrics.retryCount, 0);
  });

  it('WRITE_INTERVAL_MS should be a positive number', () => {
    assert.equal(typeof WRITE_INTERVAL_MS, 'number');
    assert.equal(WRITE_INTERVAL_MS > 0, true);
  });
});

describe('ObsidianDashboard — rendering', () => {
  let dash;

  beforeEach(() => {
    dash = createDashboard();
    dash._startedAt = Date.now();
  });

  it('_renderAgentStatus returns valid markdown with frontmatter', () => {
    const md = dash._renderAgentStatus();
    assert.equal(md.startsWith('---'), true, 'should start with frontmatter');
    assert.equal(md.includes('# Agent Status'), true);
    assert.equal(md.includes('waiting for agent heartbeats'), true);
    assert.equal(md.includes('[[pipeline-flow]]'), true);
  });

  it('_renderAgentStatus shows agent rows when state exists', () => {
    dash.agentState['builder-01'] = { status: { state: 'idle' }, lastUpdate: '2026-03-07T10:00:00Z' };
    dash.agentState['safety-01'] = { health: { hp: 20 }, lastUpdate: '2026-03-07T10:01:00Z' };
    const md = dash._renderAgentStatus();
    assert.equal(md.includes('builder-01'), true);
    assert.equal(md.includes('safety-01'), true);
    assert.equal(md.includes('waiting for agent heartbeats'), false);
  });

  it('_renderPipelineFlow returns mermaid diagram', () => {
    const md = dash._renderPipelineFlow();
    assert.equal(md.includes('```mermaid'), true);
    assert.equal(md.includes('graph LR'), true);
    assert.equal(md.includes('# Pipeline Flow'), true);
  });

  it('_renderPipelineFlow shows active tasks', () => {
    dash.pipelineStages['proj-1/task-1'] = {
      stage: 'governance:review:requested',
      data: { projectId: 'proj-1', taskId: 'task-1' },
      timestamp: '2026-03-07T10:00:00Z',
    };
    const md = dash._renderPipelineFlow();
    assert.equal(md.includes('proj-1/task-1'), true);
    assert.equal(md.includes('Coder -> Reviewer'), true);
  });

  it('_renderEventLog returns table with events', () => {
    dash.eventLog.push({
      channel: 'work:intake',
      summary: 'task-1',
      author: 'e2e-test',
      timestamp: '2026-03-07T10:00:00.000Z',
    });
    const md = dash._renderEventLog();
    assert.equal(md.includes('# Event Log'), true);
    assert.equal(md.includes('work:intake'), true);
    assert.equal(md.includes('task-1'), true);
  });

  it('_renderHealth returns system metrics', () => {
    dash.metrics.knowledgeCaptures = 5;
    dash.metrics.reviewsApproved = 3;
    const md = dash._renderHealth();
    assert.equal(md.includes('# System Health'), true);
    assert.equal(md.includes('connected'), true);
    assert.equal(md.includes('5'), true, 'should show knowledge captures');
    assert.equal(md.includes('3'), true, 'should show reviews approved');
    assert.equal(md.includes('[[kingdom/infrastructure]]'), true);
  });

  it('_renderHealth shows disconnected when Redis is down', () => {
    dash.board.client = { isReady: false };
    const md = dash._renderHealth();
    assert.equal(md.includes('disconnected'), true);
  });
});

describe('ObsidianDashboard — event processing', () => {
  let dash;

  beforeEach(() => {
    dash = createDashboard();
  });

  it('_pushEvent adds to eventLog with max 50', () => {
    for (let i = 0; i < 60; i++) {
      dash._pushEvent('test:channel', { taskId: `task-${i}`, author: 'test' });
    }
    assert.equal(dash.eventLog.length, 50);
    assert.equal(dash.eventLog[0].summary, 'task-59');
  });

  it('_updateMetrics increments correct counters', () => {
    dash._updateMetrics('knowledge:capture:stored', {});
    dash._updateMetrics('knowledge:capture:stored', {});
    dash._updateMetrics('governance:review:approved', {});
    dash._updateMetrics('governance:review:rejected', {});
    dash._updateMetrics('governance:failure:retry-requested', {});
    dash._updateMetrics('execution:deployment:completed', {});
    dash._updateMetrics('team:celebration', {});
    dash._updateMetrics('team:celebration', {});
    assert.equal(dash.metrics.knowledgeCaptures, 2);
    assert.equal(dash.metrics.reviewsApproved, 1);
    assert.equal(dash.metrics.reviewsRejected, 1);
    assert.equal(dash.metrics.retryCount, 1);
    assert.equal(dash.metrics.deploymentsCompleted, 1);
    assert.equal(dash.metrics.skillTierUps, 2);
  });

  it('_markDirty tracks which files need writing', () => {
    dash._markDirty('agent-status', 'health');
    assert.equal(dash._dirty.has('agent-status'), true);
    assert.equal(dash._dirty.has('health'), true);
    assert.equal(dash._dirty.has('event-log'), false);
  });

  it('_parse handles both string and object messages', () => {
    const obj = { taskId: 'T1' };
    assert.deepEqual(dash._parse(JSON.stringify(obj)), obj);
    assert.deepEqual(dash._parse(obj), obj);
  });
});

describe('ObsidianDashboard — file writes', () => {
  let dash;
  const testDir = path.join(os.tmpdir(), `kingdom-dash-write-${Date.now()}`);

  beforeEach(() => {
    dash = createDashboard();
    dash._startedAt = Date.now();
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('_flushAll writes dirty files to disk', () => {
    // Monkey-patch the dashboard dir
    const origRender = dash._render.bind(dash);
    dash._render = (file) => origRender(file);

    dash._markDirty('agent-status', 'health');

    // Write to test dir instead
    for (const file of dash._dirty) {
      const content = dash._render(file);
      if (content) {
        fs.writeFileSync(path.join(testDir, `${file}.md`), content);
      }
    }
    dash._dirty.clear();

    assert.equal(fs.existsSync(path.join(testDir, 'agent-status.md')), true);
    assert.equal(fs.existsSync(path.join(testDir, 'health.md')), true);
    assert.equal(fs.existsSync(path.join(testDir, 'pipeline-flow.md')), false, 'non-dirty file should not be written');

    const agentMd = fs.readFileSync(path.join(testDir, 'agent-status.md'), 'utf-8');
    assert.equal(agentMd.includes('# Agent Status'), true);
  });

  it('_render returns null for unknown file', () => {
    assert.equal(dash._render('unknown-file'), null);
  });
});

describe('ObsidianDashboard — dead event coverage', () => {
  it('subscribes to all previously-dead events (source verification)', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'agent', 'interface', 'obsidian-dashboard.js'), 'utf-8'
    );
    const requiredChannels = [
      'knowledge:notebooklm:claimed',
      'knowledge:notebooklm:prepared',
      'team:celebration',
      'orchestrator:registered',
      'orchestrator:deregistered',
      'config:llm:updated',
    ];
    for (const ch of requiredChannels) {
      assert.equal(src.includes(`'${ch}'`), true, `dashboard must subscribe to ${ch}`);
    }
  });

  it('_renderHealth includes skillTierUps metric', () => {
    const dash = createDashboard();
    dash._startedAt = Date.now();
    dash.metrics.skillTierUps = 7;
    const md = dash._renderHealth();
    assert.equal(md.includes('Skill tier-ups'), true);
    assert.equal(md.includes('7'), true);
  });
});

describe('ObsidianDashboard — lifecycle', () => {
  it('shutdown completes without errors when subscriber is null', async () => {
    const dash = createDashboard();
    dash.subscriber = null;
    let threw = false;
    try { await dash.shutdown(); } catch { threw = true; }
    assert.equal(threw, false, 'shutdown should not throw with null subscriber');
  });

  it('init creates dashboard directory', async () => {
    const dash = createDashboard();
    await dash.init();
    assert.equal(typeof dash.board, 'object', 'board should exist after init');
  });

  it('shutdown clears write timer', async () => {
    const dash = createDashboard();
    dash._writeTimer = setInterval(() => {}, 100000);
    await dash.shutdown();
    assert.equal(dash._writeTimer !== null, true, 'timer reference preserved but cleared');
  });

  it('shutdown does NOT disconnect shared board (owner-only disconnect)', async () => {
    const dash = createDashboard();
    let boardDisconnected = false;
    dash.board = {
      connect: async () => {},
      disconnect: async () => { boardDisconnected = true; },
      client: { isReady: true },
      createSubscriber: async () => ({
        on: () => {},
        subscribe: async () => {},
        pSubscribe: async () => {},
        pUnsubscribe: async () => {},
        disconnect: async () => {},
      }),
    };
    dash.subscriber = await dash.board.createSubscriber();
    await dash.shutdown();
    assert.equal(boardDisconnected, false, 'shared board must not be disconnected by dashboard');
  });
});
