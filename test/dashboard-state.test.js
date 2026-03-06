const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { URL, URLSearchParams } = require('node:url');

const {
  DashboardServer,
  parseDashboardQuery,
  buildDashboardStateUrl,
} = require('../agent/interface/dashboard');

describe('DashboardServer state API', () => {
  it('joins latest task knowledge summaries onto task payloads', async () => {
    const dashboard = new DashboardServer(0);
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
    const dashboard = new DashboardServer(0);
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
    const dashboard = new DashboardServer(0);
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
    const dashboard = new DashboardServer(0);
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
    const dashboard = new DashboardServer(0);
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
    const dashboard = new DashboardServer(0);
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
    const dashboard = new DashboardServer(0);
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
    assert.equal(data.metrics.promotionCandidates[0].taskId, 'TASK-22');
    assert.equal(data.metrics.promotionCandidates[1].status, 'promoted');
  });
});
