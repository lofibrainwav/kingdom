const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { DashboardServer } = require('../agent/interface/dashboard');

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
          updatedAt: 1700000000000,
        },
      ]),
    };
    dashboard.board = {
      listConfigs: async (prefix) => {
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
});
