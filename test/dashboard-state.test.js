const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { URL, URLSearchParams } = require('node:url');

const {
  DashboardServer,
  parseDashboardQuery,
  buildDashboardStateUrl,
  _sanitizeParam,
} = require('../agent/interface/dashboard');

describe('DashboardServer state API', () => {
  it('joins latest task knowledge summaries onto task payloads', async () => {
    const dashboard = new DashboardServer({ port: 0 });
    dashboard.taskRunner = {
      listTasks: async () => ([
        {
          projectId: 'kingdom',
          taskId: 'TASK-14',
          status: 'approved',
          goal: 'Link task knowledge',
          dryRuns: [{ summary: 'Rehearsed knowledge handoff before closeout' }],
          retry: { guardrail: 'missing-lesson' },
          updatedAt: 1700000000000,
        },
      ]),
    };
    dashboard.board = {
      listConfigs: async (prefix) => {
        if (prefix === 'knowledge:promotion:') {
          return [];
        }
        if (prefix === 'knowledge:notebooklm:') {
          return [];
        }
        assert.equal(prefix, 'knowledge:task:');
        return [
          {
            key: 'knowledge:task:kingdom:TASK-14:latest',
            value: {
              projectId: 'kingdom',
              taskId: 'TASK-14',
              title: 'Completed TASK-14',
              outcome: 'passed',
              lesson: 'Completed tasks should become durable project memory with verification attached.',
              improvementNote: 'Resolved guardrail missing-lesson after review retry.',
              capturedAt: 1700000001000,
            },
          },
        ];
      },
    };

    let statusCode = 0;
    let payload = '';
    const res = {
      writeHead: (code) => {
        statusCode = code;
      },
      end: (body) => {
        payload = body;
      },
    };

    await dashboard._handleAPIState({}, res, new URL('http://localhost/api/state'));

    const data = JSON.parse(payload);
    assert.equal(statusCode, 200);
    assert.equal(data.tasks.length, 1);
    assert.equal(data.tasks[0].latestKnowledge.title, 'Completed TASK-14');
    assert.match(data.tasks[0].latestKnowledge.improvementNote, /missing-lesson/);
    assert.equal(data.tasks[0].dryRunImpact, 'dry-run helped recovery');
    assert.equal(data.tasks[0].promotionSignal, 'ready to promote');
  });

  it('passes API query filters into task listing', async () => {
    const dashboard = new DashboardServer({ port: 0 });
    let filters = null;
    dashboard.taskRunner = {
      listTasks: async (params) => {
        filters = params;
        return [];
      },
    };
    dashboard.board = {
      listConfigs: async () => [],
    };

    const res = {
      writeHead: () => {},
      end: () => {},
    };

    await dashboard._handleAPIState(
      {},
      res,
      new URL('http://localhost/api/state?projectId=kingdom&taskId=TASK-2&status=approved&retryGuardrail=missing-evidence&retryCategory=review')
    );

    assert.deepEqual(filters, {
      projectId: 'kingdom',
      taskId: 'TASK-2',
      status: 'approved',
      retryGuardrail: 'missing-evidence',
      retryCategory: 'review',
    });
  });

  it('derives project and task recovery rates from retry and resolved metrics', async () => {
    const dashboard = new DashboardServer({ port: 0 });
    dashboard.taskRunner = {
      listTasks: async () => [],
    };
    dashboard.board = {
      listConfigs: async () => [],
    };
    dashboard.metrics.retryByProject = {
      kingdom: 4,
      sandbox: 2,
    };
    dashboard.metrics.resolvedByProject = {
      kingdom: 3,
      sandbox: 1,
    };
    dashboard.metrics.retryByTask = {
      'kingdom/TASK-1': 3,
      'kingdom/TASK-2': 1,
    };
    dashboard.metrics.resolvedByTask = {
      'kingdom/TASK-1': 2,
      'kingdom/TASK-2': 1,
    };

    let payload = '';
    const res = {
      writeHead: () => {},
      end: (body) => {
        payload = body;
      },
    };

    await dashboard._handleAPIState({}, res, new URL('http://localhost/api/state'));

    const data = JSON.parse(payload);
    assert.deepEqual(data.metrics.projectRecoveryRates, [
      { key: 'kingdom', retries: 4, resolved: 3, rate: 0.75 },
      { key: 'sandbox', retries: 2, resolved: 1, rate: 0.5 },
    ]);
    assert.deepEqual(data.metrics.taskRecoveryRates, [
      { key: 'kingdom/TASK-2', retries: 1, resolved: 1, rate: 1 },
      { key: 'kingdom/TASK-1', retries: 3, resolved: 2, rate: 0.67 },
    ]);
  });

  it('parses dashboard query state into task filter and drilldown', () => {
    const parsed = parseDashboardQuery(new URLSearchParams(
      'projectId=kingdom&retryGuardrail=missing-evidence&filter=retry'
    ));

    assert.deepEqual(parsed, {
      filter: 'retry',
      drilldown: {
        type: 'guardrail',
        value: 'missing-evidence',
      },
      apiQuery: {
        projectId: 'kingdom',
        retryGuardrail: 'missing-evidence',
      },
    });
  });

  it('builds dashboard URLs and clears query state on reset', () => {
    const focused = buildDashboardStateUrl('/', {
      filter: 'blocked',
      drilldown: { type: 'task', value: 'kingdom/TASK-9' },
    });
    assert.equal(focused, '/?filter=blocked&taskId=kingdom%2FTASK-9');

    const reset = buildDashboardStateUrl('/', {
      filter: 'all',
      drilldown: null,
    });
    assert.equal(reset, '/');
  });

  it('parses and builds play drilldown state for reusable dry-run plays', () => {
    const parsed = parseDashboardQuery(new URLSearchParams(
      'filter=ready-to-promote&retryCategory=review&dryRunSummary=Rehearse%20review%20evidence%20checklist'
    ));

    assert.deepEqual(parsed, {
      filter: 'ready-to-promote',
      drilldown: {
        type: 'play',
        category: 'review',
        value: 'Rehearse review evidence checklist',
      },
      apiQuery: {
        retryCategory: 'review',
      },
    });

    const rebuilt = buildDashboardStateUrl('/', {
      filter: 'ready-to-promote',
      drilldown: {
        type: 'play',
        category: 'review',
        value: 'Rehearse review evidence checklist',
      },
    });

    assert.equal(
      rebuilt,
      '/?filter=ready-to-promote&retryCategory=review&dryRunSummary=Rehearse+review+evidence+checklist'
    );
  });

  it('derives dry-run coverage and success rates from task state', async () => {
    const dashboard = new DashboardServer({ port: 0 });
    dashboard.taskRunner = {
      listTasks: async () => ([
        {
          projectId: 'kingdom',
          taskId: 'TASK-1',
          status: 'approved',
          dryRuns: [{ summary: 'rehearsed recovery path' }],
        },
        {
          projectId: 'kingdom',
          taskId: 'TASK-2',
          status: 'retry_requested',
          dryRuns: [{ summary: 'rehearsed guardrail handling' }],
        },
        {
          projectId: 'sandbox',
          taskId: 'TASK-3',
          status: 'completed',
          dryRuns: [],
        },
      ]),
    };
    dashboard.board = {
      listConfigs: async () => [],
    };

    let payload = '';
    const res = {
      writeHead: () => {},
      end: (body) => {
        payload = body;
      },
    };

    await dashboard._handleAPIState({}, res, new URL('http://localhost/api/state'));

    const data = JSON.parse(payload);
    assert.deepEqual(data.metrics.projectDryRunCoverage, [
      { key: 'kingdom', totalTasks: 2, dryRunTasks: 2, coverage: 1 },
      { key: 'sandbox', totalTasks: 1, dryRunTasks: 0, coverage: 0 },
    ]);
    assert.deepEqual(data.metrics.projectDryRunSuccessRates, [
      { key: 'kingdom', dryRunTasks: 2, successfulTasks: 1, successRate: 0.5 },
    ]);
  });

  it('derives project recovery comparison between dry-run and non-dry-run tasks', async () => {
    const dashboard = new DashboardServer({ port: 0 });
    dashboard.taskRunner = {
      listTasks: async () => ([
        {
          projectId: 'kingdom',
          taskId: 'TASK-1',
          status: 'approved',
          dryRuns: [{ summary: 'rehearsed recovery path' }],
          retry: { guardrail: 'missing-evidence' },
        },
        {
          projectId: 'kingdom',
          taskId: 'TASK-2',
          status: 'retry_requested',
          dryRuns: [{ summary: 'rehearsed guardrail handling' }],
          retry: { guardrail: 'missing-tests' },
        },
        {
          projectId: 'kingdom',
          taskId: 'TASK-3',
          status: 'approved',
          dryRuns: [],
          retry: { guardrail: 'missing-tests' },
        },
        {
          projectId: 'sandbox',
          taskId: 'TASK-4',
          status: 'changes_requested',
          dryRuns: [],
          retry: { guardrail: 'missing-review' },
        },
      ]),
    };
    dashboard.board = {
      listConfigs: async () => [],
    };

    let payload = '';
    const res = {
      writeHead: () => {},
      end: (body) => {
        payload = body;
      },
    };

    await dashboard._handleAPIState({}, res, new URL('http://localhost/api/state'));

    const data = JSON.parse(payload);
    assert.deepEqual(data.metrics.projectDryRunRecoveryComparison, [
      {
        key: 'kingdom',
        dryRunRetries: 2,
        dryRunResolved: 1,
        dryRunRate: 0.5,
        nonDryRunRetries: 1,
        nonDryRunResolved: 1,
        nonDryRunRate: 1,
      },
      {
        key: 'sandbox',
        dryRunRetries: 0,
        dryRunResolved: 0,
        dryRunRate: 0,
        nonDryRunRetries: 1,
        nonDryRunResolved: 0,
        nonDryRunRate: 0,
      },
    ]);
  });

  it('derives retry-category dry-run summary win rates', async () => {
    const dashboard = new DashboardServer({ port: 0 });
    dashboard.taskRunner = {
      listTasks: async () => ([
        {
          projectId: 'kingdom',
          taskId: 'TASK-1',
          status: 'approved',
          dryRuns: [{ summary: 'Rehearse review evidence checklist' }],
          retry: { category: 'review', guardrail: 'missing-evidence' },
        },
        {
          projectId: 'kingdom',
          taskId: 'TASK-2',
          status: 'retry_requested',
          dryRuns: [{ summary: 'Rehearse review evidence checklist' }],
          retry: { category: 'review', guardrail: 'missing-tests' },
        },
        {
          projectId: 'kingdom',
          taskId: 'TASK-3',
          status: 'approved',
          dryRuns: [{ summary: 'Replay implementation proof before handoff' }],
          retry: { category: 'implementation', guardrail: 'missing-proof' },
        },
      ]),
    };
    dashboard.board = {
      listConfigs: async () => [],
    };

    let payload = '';
    const res = {
      writeHead: () => {},
      end: (body) => {
        payload = body;
      },
    };

    await dashboard._handleAPIState({}, res, new URL('http://localhost/api/state'));

    const data = JSON.parse(payload);
    assert.deepEqual(data.metrics.dryRunSummaryWinRates, [
      {
        key: 'implementation :: Replay implementation proof before handoff',
        category: 'implementation',
        summary: 'Replay implementation proof before handoff',
        attempts: 1,
        wins: 1,
        winRate: 1,
      },
      {
        key: 'review :: Rehearse review evidence checklist',
        category: 'review',
        summary: 'Rehearse review evidence checklist',
        attempts: 2,
        wins: 1,
        winRate: 0.5,
      },
    ]);
  });

  it('includes promotion queue metrics and candidates from stored configs', async () => {
    const dashboard = new DashboardServer({ port: 0 });
    dashboard.taskRunner = {
      listTasks: async () => [],
    };
    dashboard.board = {
      listConfigs: async (prefix) => {
        if (prefix === 'knowledge:task:') return [];
        if (prefix === 'knowledge:promotion:') {
          return [
            {
              key: 'knowledge:promotion:kingdom:TASK-22:candidate',
              value: {
                projectId: 'kingdom',
                taskId: 'TASK-22',
                title: 'Completed TASK-22',
                promotionType: 'dry-run-recovery-play',
                status: 'queued',
                retryCategory: 'review',
                dryRunSummary: 'Rehearse review evidence checklist',
              },
            },
            {
              key: 'knowledge:promotion:kingdom:TASK-30:candidate',
              value: {
                projectId: 'kingdom',
                taskId: 'TASK-30',
                title: 'Completed TASK-30',
                promotionType: 'dry-run-recovery-play',
                status: 'promoted',
                promotedTo: 'obsidian-pattern',
                retryCategory: 'implementation',
                dryRunSummary: 'Replay implementation proof before handoff',
              },
            },
          ];
        }
        if (prefix === 'knowledge:notebooklm:') {
          return [
            {
              key: 'knowledge:notebooklm:kingdom:TASK-30:queued',
              value: {
                projectId: 'kingdom',
                taskId: 'TASK-30',
                queueType: 'promotion-source',
                sourcePath: '/tmp/completed-task-30.md',
                status: 'queued',
              },
            },
            {
              key: 'knowledge:notebooklm:kingdom:TASK-31:queued',
              value: {
                projectId: 'kingdom',
                taskId: 'TASK-31',
                queueType: 'promotion-source',
                sourcePath: '/tmp/completed-task-31.md',
                status: 'claimed',
              },
            },
            {
              key: 'knowledge:notebooklm:kingdom:TASK-32:queued',
              value: {
                projectId: 'kingdom',
                taskId: 'TASK-32',
                queueType: 'promotion-source',
                sourcePath: '/tmp/completed-task-32.md',
                status: 'prepared',
              },
            },
            {
              key: 'knowledge:notebooklm:kingdom:TASK-33:queued',
              value: {
                projectId: 'kingdom',
                taskId: 'TASK-33',
                queueType: 'promotion-source',
                sourcePath: '/tmp/completed-task-33.md',
                status: 'ingested',
                registryPath: '/tmp/notebooklm-ingestion-registry.md',
              },
            },
          ];
        }
        return [];
      },
    };

    let payload = '';
    const res = {
      writeHead: () => {},
      end: (body) => {
        payload = body;
      },
    };

    await dashboard._handleAPIState({}, res, new URL('http://localhost/api/state'));

    const data = JSON.parse(payload);
    assert.equal(data.metrics.promotionQueueCounts.queued, 1);
    assert.equal(data.metrics.promotionQueueCounts.promoted, 1);
    assert.equal(data.metrics.promotionAppliedCount, 1);
    assert.equal(data.metrics.promotionConversionCounts['obsidian-pattern'], 1);
    assert.equal(data.metrics.notebooklmQueueCount, 4);
    assert.equal(data.metrics.notebooklmQueueCounts.queued, 1);
    assert.equal(data.metrics.notebooklmQueueCounts.claimed, 1);
    assert.equal(data.metrics.notebooklmQueueCounts.prepared, 1);
    assert.equal(data.metrics.notebooklmQueueCounts.ingested, 1);
    assert.equal(data.metrics.promotionCandidates[0].taskId, 'TASK-22');
    assert.equal(data.metrics.promotionCandidates[1].status, 'promoted');
  });
});

describe('DashboardServer — teamleadHealth in API state', () => {
  it('includes teamleadHealth from Redis when getConfig is available', async () => {
    const dashboard = new DashboardServer({ port: 0 });
    dashboard.taskRunner = { listTasks: async () => [] };
    const healthData = {
      timestamp: 1700000000000,
      agentCount: 17,
      activeAgents: 3,
      trackedProjects: 2,
      bottlenecks: [],
    };
    dashboard.board = {
      listConfigs: async () => [],
      getConfig: async (key) => key === 'teamlead:health' ? healthData : null,
    };

    let payload = '';
    const res = {
      writeHead: () => {},
      end: (body) => { payload = body; },
    };

    await dashboard._handleAPIState({}, res, new URL('http://localhost/api/state'));
    const data = JSON.parse(payload);
    assert.deepEqual(data.teamleadHealth, healthData);
    assert.equal(data.teamleadHealth.agentCount, 17);
  });

  it('returns null teamleadHealth when getConfig is not available', async () => {
    const dashboard = new DashboardServer({ port: 0 });
    dashboard.taskRunner = { listTasks: async () => [] };
    dashboard.board = { listConfigs: async () => [] };

    let payload = '';
    const res = {
      writeHead: () => {},
      end: (body) => { payload = body; },
    };

    await dashboard._handleAPIState({}, res, new URL('http://localhost/api/state'));
    const data = JSON.parse(payload);
    assert.equal(data.teamleadHealth, null);
  });
});

describe('_sanitizeParam — input validation', () => {
  it('returns null for falsy values', () => {
    assert.equal(_sanitizeParam(null), null);
    assert.equal(_sanitizeParam(undefined), null);
    assert.equal(_sanitizeParam(''), null);
    assert.equal(_sanitizeParam(0), null);
  });

  it('returns null for non-string values', () => {
    assert.equal(_sanitizeParam(42), null);
    assert.equal(_sanitizeParam({}), null);
    assert.equal(_sanitizeParam([]), null);
    assert.equal(_sanitizeParam(true), null);
  });

  it('returns null for strings exceeding 256 chars', () => {
    const long = 'a'.repeat(257);
    assert.equal(_sanitizeParam(long), null);
    // Exactly 256 should pass
    const exact = 'b'.repeat(256);
    assert.equal(_sanitizeParam(exact), exact);
  });

  it('strips dangerous characters', () => {
    assert.equal(_sanitizeParam('hello<script>alert(1)</script>'), 'helloscriptalert1/script');
    assert.equal(_sanitizeParam('key=value&other'), 'keyvalueother');
    assert.equal(_sanitizeParam('normal_text-123'), 'normal_text-123');
  });

  it('allows safe characters: word chars, colons, dots, slashes, @, spaces', () => {
    assert.equal(_sanitizeParam('project:task_01'), 'project:task_01');
    assert.equal(_sanitizeParam('user@domain.com'), 'user@domain.com');
    assert.equal(_sanitizeParam('path/to/file'), 'path/to/file');
    assert.equal(_sanitizeParam('with spaces'), 'with spaces');
  });
});

// ── Internal methods unit tests ────────────────────────────────────

describe('DashboardServer — _incrementMetricBucket', () => {
  it('increments a new key from 0 to 1', () => {
    const dashboard = new DashboardServer({ port: 0 });
    dashboard._incrementMetricBucket('retryByCategory', 'review');
    assert.equal(dashboard.metrics.retryByCategory.review, 1);
  });

  it('increments an existing key', () => {
    const dashboard = new DashboardServer({ port: 0 });
    dashboard.metrics.retryByCategory.review = 5;
    dashboard._incrementMetricBucket('retryByCategory', 'review');
    assert.equal(dashboard.metrics.retryByCategory.review, 6);
  });

  it('prunes to 100 entries when exceeding limit', () => {
    const dashboard = new DashboardServer({ port: 0 });
    // Fill with 100 entries (counts 1..100)
    for (let i = 0; i < 100; i++) {
      dashboard.metrics.retryByCategory[`key-${i}`] = i + 1;
    }
    // Adding 101st triggers pruning — lowest count entry removed
    dashboard._incrementMetricBucket('retryByCategory', 'overflow');
    const keys = Object.keys(dashboard.metrics.retryByCategory);
    assert.equal(keys.length, 100);
    // key-0 had count 1 (lowest) — should be pruned
    assert.equal(dashboard.metrics.retryByCategory['key-0'], undefined);
    // overflow was just added with count 1, but key-0 was pruned first
    assert.equal(dashboard.metrics.retryByCategory.overflow, 1);
  });
});

describe('DashboardServer — _remember* event memory', () => {
  it('_rememberKnowledgeEvent stores up to 6 events (FIFO)', () => {
    const dashboard = new DashboardServer({ port: 0 });
    for (let i = 0; i < 8; i++) {
      dashboard._rememberKnowledgeEvent({ type: 'capture', title: `event-${i}` });
    }
    assert.equal(dashboard.metrics.recentKnowledge.length, 6);
    assert.equal(dashboard.metrics.recentKnowledge[0].title, 'event-7');
    assert.equal(dashboard.metrics.recentKnowledge[5].title, 'event-2');
  });

  it('_rememberTaskEvent stores up to 6 events with timestamps', () => {
    const dashboard = new DashboardServer({ port: 0 });
    dashboard._rememberTaskEvent({ type: 'task-completed', title: 'TASK-1' });
    assert.equal(dashboard.metrics.recentTasks.length, 1);
    assert.ok(dashboard.metrics.recentTasks[0].timestamp > 0);
    assert.equal(dashboard.metrics.recentTasks[0].title, 'TASK-1');
  });

  it('_rememberPromotionEvent stores up to 6 events', () => {
    const dashboard = new DashboardServer({ port: 0 });
    for (let i = 0; i < 7; i++) {
      dashboard._rememberPromotionEvent({ type: 'candidate', title: `promo-${i}` });
    }
    assert.equal(dashboard.metrics.recentPromotions.length, 6);
    assert.equal(dashboard.metrics.recentPromotions[0].title, 'promo-6');
  });
});

describe('DashboardServer — _broadcast', () => {
  it('writes SSE payload to connected clients', () => {
    const dashboard = new DashboardServer({ port: 0 });
    const written = [];
    const mockClient = { write: (data) => { written.push(data); return true; } };
    dashboard.sseClients.push(mockClient);
    dashboard._broadcast({ type: 'test', data: 'hello' });
    assert.equal(written.length, 1);
    assert.match(written[0], /^data: /);
    const parsed = JSON.parse(written[0].replace('data: ', '').trim());
    assert.equal(parsed.type, 'test');
  });

  it('removes clients that throw on write', () => {
    const dashboard = new DashboardServer({ port: 0 });
    const goodWrites = [];
    const goodClient = { write: (data) => { goodWrites.push(data); return true; } };
    const badClient = { write: () => { throw new Error('closed'); } };
    dashboard.sseClients.push(badClient, goodClient);
    dashboard._broadcast({ type: 'test' });
    assert.equal(dashboard.sseClients.length, 1);
    assert.equal(goodWrites.length, 1);
  });
});

describe('DashboardServer — _taskMetricKey', () => {
  it('returns projectId/taskId format', () => {
    const dashboard = new DashboardServer({ port: 0 });
    assert.equal(dashboard._taskMetricKey({ projectId: 'kingdom', taskId: 'TASK-1' }), 'kingdom/TASK-1');
  });

  it('handles missing fields with defaults', () => {
    const dashboard = new DashboardServer({ port: 0 });
    assert.equal(dashboard._taskMetricKey({}), 'unknown-project/unknown-task');
    assert.equal(dashboard._taskMetricKey(null), 'unknown-project/unknown-task');
    assert.equal(dashboard._taskMetricKey(undefined), 'unknown-project/unknown-task');
  });
});

describe('DashboardServer — _deriveDryRunImpact', () => {
  it('returns "dry-run helped recovery" for retry+dryRun+resolved', () => {
    const dashboard = new DashboardServer({ port: 0 });
    const result = dashboard._deriveDryRunImpact({
      retry: { guardrail: 'test' },
      dryRuns: [{ summary: 'rehearsed' }],
      status: 'approved',
    });
    assert.equal(result, 'dry-run helped recovery');
  });

  it('returns "dry-run rehearsed, recovery pending" for retry+dryRun but not resolved', () => {
    const dashboard = new DashboardServer({ port: 0 });
    const result = dashboard._deriveDryRunImpact({
      retry: { guardrail: 'test' },
      dryRuns: [{ summary: 'rehearsed' }],
      status: 'retry_requested',
    });
    assert.equal(result, 'dry-run rehearsed, recovery pending');
  });

  it('returns "recovered without dry-run" for retry+resolved but no dryRun', () => {
    const dashboard = new DashboardServer({ port: 0 });
    const result = dashboard._deriveDryRunImpact({
      retry: { guardrail: 'test' },
      dryRuns: [],
      status: 'completed',
    });
    assert.equal(result, 'recovered without dry-run');
  });

  it('returns "no dry-run signal" for plain task', () => {
    const dashboard = new DashboardServer({ port: 0 });
    assert.equal(dashboard._deriveDryRunImpact({}), 'no dry-run signal');
    assert.equal(dashboard._deriveDryRunImpact(), 'no dry-run signal');
  });
});

describe('DashboardServer — _derivePromotionSignal', () => {
  it('returns "ready to promote" when dry-run helped and knowledge exists', () => {
    const dashboard = new DashboardServer({ port: 0 });
    const task = { retry: { guardrail: 'g' }, dryRuns: [{ summary: 's' }], status: 'approved' };
    const knowledge = { title: 'Completed task' };
    assert.equal(dashboard._derivePromotionSignal(task, knowledge), 'ready to promote');
  });

  it('returns "knowledge captured" when knowledge exists but no dry-run recovery', () => {
    const dashboard = new DashboardServer({ port: 0 });
    assert.equal(dashboard._derivePromotionSignal({}, { title: 'Captured' }), 'knowledge captured');
  });

  it('returns "awaiting capture" when no knowledge', () => {
    const dashboard = new DashboardServer({ port: 0 });
    assert.equal(dashboard._derivePromotionSignal({}, null), 'awaiting capture');
  });
});

describe('DashboardServer — getState', () => {
  it('returns a copy of agentState', () => {
    const dashboard = new DashboardServer({ port: 0 });
    dashboard.agentState.Kingdom_PM = { status: { state: 'idle' } };
    const state = dashboard.getState();
    assert.deepEqual(state, { Kingdom_PM: { status: { state: 'idle' } } });
    // Verify it is a copy
    state.Kingdom_PM = null;
    assert.ok(dashboard.agentState.Kingdom_PM !== null);
  });
});

describe('DashboardServer — HTTP routing', () => {
  it('returns 404 for unknown paths', async () => {
    const dashboard = new DashboardServer({ port: 0 });
    let statusCode = 0;
    let body = '';
    const res = {
      writeHead: (code) => { statusCode = code; },
      end: (data) => { body = data; },
    };
    await dashboard._handleRequest(
      { url: '/unknown', headers: {} },
      res
    );
    assert.equal(statusCode, 404);
    assert.equal(body, 'Not found');
  });

  it('serves HTML for / path', async () => {
    const dashboard = new DashboardServer({ port: 0 });
    let statusCode = 0;
    let headers = {};
    let body = '';
    const res = {
      writeHead: (code, h) => { statusCode = code; headers = h; },
      end: (data) => { body = data; },
    };
    await dashboard._handleRequest(
      { url: '/', headers: {} },
      res
    );
    assert.equal(statusCode, 200);
    assert.equal(headers['Content-Type'], 'text/html');
    assert.match(body, /Kingdom Operating Console/);
  });

  it('sets up SSE for /events path', async () => {
    const dashboard = new DashboardServer({ port: 0 });
    let statusCode = 0;
    let headers = {};
    const written = [];
    const listeners = {};
    const res = {
      writeHead: (code, h) => { statusCode = code; headers = h; },
      write: (data) => { written.push(data); },
    };
    const req = {
      url: '/events',
      headers: {},
      on: (event, cb) => { listeners[event] = cb; },
    };
    await dashboard._handleRequest(req, res);
    assert.equal(statusCode, 200);
    assert.equal(headers['Content-Type'], 'text/event-stream');
    assert.equal(dashboard.sseClients.length, 1);
    assert.match(written[0], /connected/);
    // Simulate client disconnect
    listeners.close();
    assert.equal(dashboard.sseClients.length, 0);
  });
});

describe('DashboardServer — _derivePromotionQueueCounts', () => {
  it('counts candidates by status', () => {
    const dashboard = new DashboardServer({ port: 0 });
    const candidates = [
      { status: 'queued' },
      { status: 'queued' },
      { status: 'promoted' },
    ];
    assert.deepEqual(dashboard._derivePromotionQueueCounts(candidates), { queued: 2, promoted: 1 });
  });

  it('defaults missing status to "queued"', () => {
    const dashboard = new DashboardServer({ port: 0 });
    assert.deepEqual(dashboard._derivePromotionQueueCounts([{}]), { queued: 1 });
  });
});

describe('DashboardServer — _derivePromotionConversionCounts', () => {
  it('counts only promoted candidates by promotedTo type', () => {
    const dashboard = new DashboardServer({ port: 0 });
    const candidates = [
      { status: 'promoted', promotedTo: 'obsidian-pattern' },
      { status: 'promoted', promotedTo: 'obsidian-pattern' },
      { status: 'promoted', promotedTo: 'skill-upgrade' },
      { status: 'queued' },
    ];
    const result = dashboard._derivePromotionConversionCounts(candidates);
    assert.deepEqual(result, { 'obsidian-pattern': 2, 'skill-upgrade': 1 });
  });
});
