/**
 * Kingdom Dashboard Server — Phase 6.1
 * Real-time web dashboard with SSE for agent monitoring.
 * Usage: node agent/dashboard.js (port 3000)
 */
const http = require('http');
const { URL, URLSearchParams } = require('url');
const { Blackboard } = require('../core/blackboard');
const { getLogger } = require('../core/logger');
const { TaskRunner } = require('../core/task-runner');
const log = getLogger();

const PORT = process.env.DASHBOARD_PORT || 3000;

function parseDashboardQuery(searchParams) {
  const filter = searchParams.get('filter') || 'all';

  if (searchParams.get('taskId')) {
    return {
      filter,
      drilldown: { type: 'task', value: searchParams.get('taskId') },
      apiQuery: {
        ...(searchParams.get('projectId') ? { projectId: searchParams.get('projectId') } : {}),
        taskId: searchParams.get('taskId'),
      },
    };
  }

  if (searchParams.get('retryCategory') && searchParams.get('dryRunSummary')) {
    return {
      filter,
      drilldown: {
        type: 'play',
        category: searchParams.get('retryCategory'),
        value: searchParams.get('dryRunSummary'),
      },
      apiQuery: {
        ...(searchParams.get('projectId') ? { projectId: searchParams.get('projectId') } : {}),
        retryCategory: searchParams.get('retryCategory'),
      },
    };
  }

  if (searchParams.get('retryGuardrail')) {
    return {
      filter,
      drilldown: { type: 'guardrail', value: searchParams.get('retryGuardrail') },
      apiQuery: {
        ...(searchParams.get('projectId') ? { projectId: searchParams.get('projectId') } : {}),
        retryGuardrail: searchParams.get('retryGuardrail'),
      },
    };
  }

  if (searchParams.get('retryCategory')) {
    return {
      filter,
      drilldown: { type: 'category', value: searchParams.get('retryCategory') },
      apiQuery: {
        ...(searchParams.get('projectId') ? { projectId: searchParams.get('projectId') } : {}),
        retryCategory: searchParams.get('retryCategory'),
      },
    };
  }

  if (searchParams.get('projectId')) {
    return {
      filter,
      drilldown: { type: 'project', value: searchParams.get('projectId') },
      apiQuery: { projectId: searchParams.get('projectId') },
    };
  }

  return {
    filter,
    drilldown: null,
    apiQuery: {},
  };
}

function buildDashboardStateUrl(basePath, { filter = 'all', drilldown = null } = {}) {
  const params = new URLSearchParams();

  if (filter && filter !== 'all') {
    params.set('filter', filter);
  }

  if (drilldown?.type === 'project') {
    params.set('projectId', drilldown.value);
  }
  if (drilldown?.type === 'task') {
    params.set('taskId', drilldown.value);
  }
  if (drilldown?.type === 'guardrail') {
    params.set('retryGuardrail', drilldown.value);
  }
  if (drilldown?.type === 'category') {
    params.set('retryCategory', drilldown.value);
  }
  if (drilldown?.type === 'play') {
    params.set('retryCategory', drilldown.category);
    params.set('dryRunSummary', drilldown.value);
  }

  const query = params.toString();
  return query ? `${basePath}?${query}` : basePath;
}

class DashboardServer {
  constructor(port = PORT) {
    this.port = port;
    this.board = new Blackboard();
    this.server = null;
    this.sseClients = [];
    this.subscriber = null;
    this.agentState = {};
    this.taskRunner = new TaskRunner({ board: this.board });
    this.metrics = {
      knowledgeCaptures: 0,
      skillEvals: 0,
      lastSkillEval: null,
      recentKnowledge: [],
      recentPromotions: [],
      recentTasks: [],
      retryByCategory: {},
      retryByGuardrail: {},
      retryByProject: {},
      retryByTask: {},
      resolvedGuardrails: {},
      resolvedByProject: {},
      resolvedByTask: {},
    };
  }

  async start() {
    await this.board.connect();
    this.subscriber = await this.board.createSubscriber();
    this.subscriber.on('error', (err) => log.error('dashboard', 'Redis sub error', { error: err.message }));
    this._subscribeUpdates();

    this.server = http.createServer((req, res) => {
      void this._handleRequest(req, res);
    });
    return new Promise((resolve) => {
      this.server.listen(this.port, () => {
        log.info('dashboard', `http://localhost:${this.port}`);
        resolve();
      });
    });
  }

  async stop() {
    for (const client of this.sseClients) {
      client.end();
    }
    this.sseClients = [];
    if (this.subscriber) {
      await this.subscriber.pUnsubscribe();
      await this.subscriber.disconnect();
    }
    if (this.server) {
      this.server.closeAllConnections();
      await new Promise((resolve) => this.server.close(resolve));
    }
    await this.board.disconnect();
  }

  _subscribeUpdates() {
    this.subscriber.pSubscribe('agent:*', (message, channel) => {
      try {
        const data = typeof message === 'string' ? JSON.parse(message) : message;
        const parts = channel.split(':');
        const agentId = parts[2];
        const eventType = parts.slice(3).join(':');

        this.agentState[agentId] = {
          ...this.agentState[agentId],
          [eventType]: data,
          lastUpdate: Date.now(),
        };

        this._broadcast({ type: eventType, agentId, data });
      } catch {}
    });

    this.subscriber.pSubscribe('governance:safety:*', (message, channel) => {
      try {
        const data = typeof message === 'string' ? JSON.parse(message) : message;
        this._broadcast({ type: 'safety', channel, data });
      } catch {}
    });

    this.subscriber.subscribe('governance:task:completed', (message) => {
      try {
        const data = typeof message === 'string' ? JSON.parse(message) : message;
        this._rememberTaskEvent({
          type: 'task-completed',
          title: data.taskId,
          outcome: 'completed',
          detail: data.projectId,
        });
        this._broadcast({ type: 'task-closeout', channel: 'governance:task:completed', data });
      } catch {}
    });

    this.subscriber.subscribe('governance:review:requested', (message) => {
      try {
        const data = typeof message === 'string' ? JSON.parse(message) : message;
        this._rememberTaskEvent({
          type: 'review-requested',
          title: data.taskId,
          outcome: 'requested',
          detail: data.file,
        });
        this._broadcast({ type: 'task-closeout', channel: 'governance:review:requested', data });
      } catch {}
    });

    this.subscriber.subscribe('governance:review:approved', (message) => {
      try {
        const data = typeof message === 'string' ? JSON.parse(message) : message;
        this._rememberTaskEvent({
          type: 'review-approved',
          title: data.taskId,
          outcome: 'approved',
          detail: data.file,
        });
        this._broadcast({ type: 'task-closeout', channel: 'governance:review:approved', data });
      } catch {}
    });

    this.subscriber.subscribe('governance:review:rejected', (message) => {
      try {
        const data = typeof message === 'string' ? JSON.parse(message) : message;
        this._rememberTaskEvent({
          type: 'review-rejected',
          title: data.taskId,
          outcome: 'rejected',
          detail: data.file,
        });
        this._broadcast({ type: 'task-closeout', channel: 'governance:review:rejected', data });
      } catch {}
    });

    this.subscriber.subscribe('governance:failure:retry-requested', (message) => {
      try {
        const data = typeof message === 'string' ? JSON.parse(message) : message;
        this._incrementMetricBucket('retryByCategory', data.category || 'unknown');
        this._incrementMetricBucket('retryByGuardrail', data.guardrail || 'unknown');
        this._incrementMetricBucket('retryByProject', data.projectId || 'unknown');
        this._incrementMetricBucket('retryByTask', this._taskMetricKey(data));
        this._rememberTaskEvent({
          type: 'retry-requested',
          title: data.taskId,
          outcome: 'retry',
          detail: data.guardrail,
        });
        this._broadcast({ type: 'task-closeout', channel: 'governance:failure:retry-requested', data });
      } catch {}
    });

    // Work plane — pipeline progress visibility
    this.subscriber.subscribe('work:intake', (message) => {
      try {
        const data = typeof message === 'string' ? JSON.parse(message) : message;
        this._broadcast({ type: 'work-intake', channel: 'work:intake', data });
      } catch {}
    });
    this.subscriber.subscribe('work:planning:init', (message) => {
      try {
        const data = typeof message === 'string' ? JSON.parse(message) : message;
        this._broadcast({ type: 'work-planning-init', channel: 'work:planning:init', data });
      } catch {}
    });
    this.subscriber.subscribe('work:planning:designed', (message) => {
      try {
        const data = typeof message === 'string' ? JSON.parse(message) : message;
        this._broadcast({ type: 'work-planning-designed', channel: 'work:planning:designed', data });
      } catch {}
    });
    this.subscriber.subscribe('work:planning:decomposed', (message) => {
      try {
        const data = typeof message === 'string' ? JSON.parse(message) : message;
        this._broadcast({ type: 'work-planning-decomposed', channel: 'work:planning:decomposed', data });
      } catch {}
    });

    // Execution plane — deployment + watchdog visibility
    this.subscriber.subscribe('execution:deployment:completed', (message) => {
      try {
        const data = typeof message === 'string' ? JSON.parse(message) : message;
        this._broadcast({ type: 'deployment-completed', channel: 'execution:deployment:completed', data });
      } catch {}
    });
    this.subscriber.subscribe('governance:watchdog:recovery', (message) => {
      try {
        const data = typeof message === 'string' ? JSON.parse(message) : message;
        this._broadcast({ type: 'watchdog-recovery', channel: 'governance:watchdog:recovery', data });
      } catch {}
    });

    this.subscriber.pSubscribe('knowledge:reflexion:*', (message, channel) => {
      try {
        const data = typeof message === 'string' ? JSON.parse(message) : message;
        this._broadcast({ type: 'leader', channel, data });
      } catch {}
    });

    this.subscriber.subscribe('knowledge:capture:stored', (message) => {
      try {
        const data = typeof message === 'string' ? JSON.parse(message) : message;
        this.metrics.knowledgeCaptures += 1;
        if (data.outcome === 'passed' && data.retryGuardrail) {
          this._incrementMetricBucket('resolvedGuardrails', data.retryGuardrail);
          this._incrementMetricBucket('resolvedByProject', data.projectId || 'unknown');
          this._incrementMetricBucket(
            'resolvedByTask',
            this._taskMetricKey({
              projectId: data.projectId,
              taskId: data.taskId || data.continuationTaskId,
            })
          );
        }
        this._rememberKnowledgeEvent({
          type: 'capture',
          title: data.title,
          outcome: data.outcome,
          projectId: data.projectId,
          detail: data.improvementNote || data.retryGuardrail || data.projectId,
        });
        this._broadcast({ type: 'knowledge-capture', channel: 'knowledge:capture:stored', data });
      } catch {}
    });

    this.subscriber.subscribe('knowledge:skill:eval-completed', (message) => {
      try {
        const data = typeof message === 'string' ? JSON.parse(message) : message;
        this.metrics.skillEvals += 1;
        this.metrics.lastSkillEval = data;
        this._rememberKnowledgeEvent({
          type: 'skill-eval',
          title: data.skillName,
          outcome: data.passed ? 'passed' : 'failed',
          score: data.score,
        });
        this._broadcast({ type: 'skill-eval', channel: 'knowledge:skill:eval-completed', data });
      } catch {}
    });

    this.subscriber.subscribe('knowledge:promotion:candidate', (message) => {
      try {
        const data = typeof message === 'string' ? JSON.parse(message) : message;
        this._rememberPromotionEvent({
          type: 'candidate',
          title: data.title,
          outcome: data.promotionType,
          detail: data.retryCategory || data.taskId,
        });
        this._broadcast({ type: 'promotion-candidate', channel: 'knowledge:promotion:candidate', data });
      } catch {}
    });

    this.subscriber.subscribe('knowledge:promotion:applied', (message) => {
      try {
        const data = typeof message === 'string' ? JSON.parse(message) : message;
        this._rememberPromotionEvent({
          type: 'applied',
          title: data.taskId,
          outcome: data.promotedTo,
          detail: data.promotionType,
        });
        this._broadcast({ type: 'promotion-applied', channel: 'knowledge:promotion:applied', data });
      } catch {}
    });

    this.subscriber.subscribe('knowledge:notebooklm:claimed', (message) => {
      try {
        const data = typeof message === 'string' ? JSON.parse(message) : message;
        this._rememberPromotionEvent({
          type: 'notebooklm-claimed',
          title: data.taskId,
          outcome: data.queueType,
          detail: 'claimed',
        });
        this._broadcast({ type: 'notebooklm-claimed', channel: 'knowledge:notebooklm:claimed', data });
      } catch {}
    });

    this.subscriber.subscribe('knowledge:notebooklm:prepared', (message) => {
      try {
        const data = typeof message === 'string' ? JSON.parse(message) : message;
        this._rememberPromotionEvent({
          type: 'notebooklm-prepared',
          title: data.taskId,
          outcome: data.queueType,
          detail: 'prepared',
        });
        this._broadcast({ type: 'notebooklm-prepared', channel: 'knowledge:notebooklm:prepared', data });
      } catch {}
    });

    this.subscriber.subscribe('knowledge:notebooklm:ingested', (message) => {
      try {
        const data = typeof message === 'string' ? JSON.parse(message) : message;
        this._rememberPromotionEvent({
          type: 'notebooklm-ingested',
          title: data.taskId,
          outcome: data.queueType,
          detail: 'ingested',
        });
        this._broadcast({ type: 'notebooklm-ingested', channel: 'knowledge:notebooklm:ingested', data });
      } catch {}
    });
  }

  _rememberKnowledgeEvent(event) {
    this.metrics.recentKnowledge.unshift({
      ...event,
      timestamp: Date.now(),
    });
    this.metrics.recentKnowledge = this.metrics.recentKnowledge.slice(0, 6);
  }

  _rememberTaskEvent(event) {
    this.metrics.recentTasks.unshift({
      ...event,
      timestamp: Date.now(),
    });
    this.metrics.recentTasks = this.metrics.recentTasks.slice(0, 6);
  }

  _rememberPromotionEvent(event) {
    this.metrics.recentPromotions.unshift({
      ...event,
      timestamp: Date.now(),
    });
    this.metrics.recentPromotions = this.metrics.recentPromotions.slice(0, 6);
  }

  _incrementMetricBucket(bucket, key) {
    this.metrics[bucket][key] = (this.metrics[bucket][key] || 0) + 1;
  }

  _broadcast(event) {
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    this.sseClients = this.sseClients.filter((client) => {
      try {
        client.write(payload);
        return true;
      } catch {
        return false;
      }
    });
  }

  async _handleRequest(req, res) {
    const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (requestUrl.pathname === '/events') {
      return this._handleSSE(req, res);
    }
    if (requestUrl.pathname === '/api/state') {
      return this._handleAPIState(req, res, requestUrl);
    }
    if (requestUrl.pathname === '/' || requestUrl.pathname === '/index.html') {
      return this._serveDashboard(req, res);
    }
    res.writeHead(404);
    res.end('Not found');
  }

  _handleSSE(req, res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    res.write('data: {"type":"connected"}\n\n');
    this.sseClients.push(res);
    req.on('close', () => {
      this.sseClients = this.sseClients.filter((c) => c !== res);
    });
  }

  _taskMetricKey(data) {
    const projectId = data?.projectId || 'unknown-project';
    const taskId = data?.taskId || 'unknown-task';
    return `${projectId}/${taskId}`;
  }

  async _loadTaskKnowledgeIndex({ projectId, taskId } = {}) {
    if (!this.board.listConfigs) {
      return new Map();
    }

    const prefix = projectId
      ? `knowledge:task:${projectId}:`
      : 'knowledge:task:';
    const entries = await this.board.listConfigs(prefix);
    const index = new Map();

    for (const { value } of entries) {
      if (!value?.projectId || !value?.taskId) {
        continue;
      }
      if (taskId && value.taskId !== taskId) {
        continue;
      }
      index.set(`${value.projectId}:${value.taskId}`, value);
    }

    return index;
  }

  async _loadPromotionCandidates({ projectId, taskId } = {}) {
    if (!this.board.listConfigs) {
      return [];
    }

    const prefix = projectId
      ? `knowledge:promotion:${projectId}:`
      : 'knowledge:promotion:';
    const entries = await this.board.listConfigs(prefix);

    return entries
      .map(({ value }) => value)
      .filter((value) => value?.projectId && value?.taskId)
      .filter((value) => !taskId || value.taskId === taskId)
      .sort((a, b) => {
        const aTime = Date.parse(a.capturedAt || a.promotedAt || 0);
        const bTime = Date.parse(b.capturedAt || b.promotedAt || 0);
        return bTime - aTime || a.taskId.localeCompare(b.taskId);
      });
  }

  async _loadNotebookLMQueue({ projectId, taskId } = {}) {
    if (!this.board.listConfigs) {
      return [];
    }

    const prefix = projectId
      ? `knowledge:notebooklm:${projectId}:`
      : 'knowledge:notebooklm:';
    const entries = await this.board.listConfigs(prefix);

    return entries
      .map(({ value }) => value)
      .filter((value) => value?.projectId && value?.taskId)
      .filter((value) => !taskId || value.taskId === taskId)
      .sort((a, b) => {
        const aTime = Date.parse(a.queuedAt || 0);
        const bTime = Date.parse(b.queuedAt || 0);
        return bTime - aTime || a.taskId.localeCompare(b.taskId);
      });
  }

  async _handleAPIState(req, res, requestUrl) {
    const filters = {
      projectId: requestUrl.searchParams.get('projectId') || undefined,
      taskId: requestUrl.searchParams.get('taskId') || undefined,
      status: requestUrl.searchParams.get('status') || undefined,
      retryGuardrail: requestUrl.searchParams.get('retryGuardrail') || undefined,
      retryCategory: requestUrl.searchParams.get('retryCategory') || undefined,
    };
    const tasks = await this.taskRunner.listTasks(filters);
    this.taskRunnerCachedTasks = tasks;
    const taskKnowledge = await this._loadTaskKnowledgeIndex(filters);
    const promotionCandidates = await this._loadPromotionCandidates(filters);
    const notebooklmQueue = await this._loadNotebookLMQueue(filters);
    const hydratedTasks = tasks.map((task) => ({
      ...task,
      latestKnowledge: taskKnowledge.get(`${task.projectId}:${task.taskId}`) || null,
      dryRunImpact: this._deriveDryRunImpact(task),
      promotionSignal: this._derivePromotionSignal(task, taskKnowledge.get(`${task.projectId}:${task.taskId}`) || null),
    }));
    const derivedMetrics = this._buildRecoveryMetrics();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      agents: this.agentState,
      tasks: hydratedTasks,
      metrics: {
        ...this.metrics,
        ...derivedMetrics,
        promotionCandidates,
        promotionQueueCounts: this._derivePromotionQueueCounts(promotionCandidates),
        promotionAppliedCount: promotionCandidates.filter((entry) => entry.status === 'promoted').length,
        promotionConversionCounts: this._derivePromotionConversionCounts(promotionCandidates),
        notebooklmQueueCount: notebooklmQueue.length,
        notebooklmQueueCounts: this._derivePromotionQueueCounts(notebooklmQueue),
      },
      timestamp: Date.now(),
    }));
  }

  _buildRecoveryMetrics() {
    return {
      projectRecoveryRates: this._deriveRateList(this.metrics.retryByProject, this.metrics.resolvedByProject),
      taskRecoveryRates: this._deriveRateList(this.metrics.retryByTask, this.metrics.resolvedByTask),
      projectDryRunCoverage: this._deriveDryRunCoverageList(this.taskRunnerCachedTasks || []),
      projectDryRunSuccessRates: this._deriveDryRunSuccessList(this.taskRunnerCachedTasks || []),
      projectDryRunRecoveryComparison: this._deriveDryRunRecoveryComparison(this.taskRunnerCachedTasks || []),
      dryRunSummaryWinRates: this._deriveDryRunSummaryWinRates(this.taskRunnerCachedTasks || []),
    };
  }

  _derivePromotionQueueCounts(candidates = []) {
    return candidates.reduce((acc, candidate) => {
      const status = candidate.status || 'queued';
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    }, {});
  }

  _derivePromotionConversionCounts(candidates = []) {
    return candidates
      .filter((candidate) => candidate.status === 'promoted' && candidate.promotedTo)
      .reduce((acc, candidate) => {
        acc[candidate.promotedTo] = (acc[candidate.promotedTo] || 0) + 1;
        return acc;
      }, {});
  }

  _deriveRateList(retryBucket = {}, resolvedBucket = {}) {
    return Object.entries(retryBucket)
      .map(([key, retries]) => {
        const resolved = resolvedBucket[key] || 0;
        const rate = retries > 0 ? Number((resolved / retries).toFixed(2)) : 0;
        return { key, retries, resolved, rate };
      })
      .sort((a, b) => {
        if (b.rate !== a.rate) {
          return b.rate - a.rate;
        }
        if (b.resolved !== a.resolved) {
          return b.resolved - a.resolved;
        }
        return a.key.localeCompare(b.key);
      });
  }

  _deriveDryRunCoverageList(tasks = []) {
    const byProject = new Map();
    for (const task of tasks) {
      const key = task.projectId || 'unknown';
      const current = byProject.get(key) || { key, totalTasks: 0, dryRunTasks: 0 };
      current.totalTasks += 1;
      if ((task.dryRuns || []).length > 0) {
        current.dryRunTasks += 1;
      }
      byProject.set(key, current);
    }

    return [...byProject.values()]
      .map((entry) => ({
        ...entry,
        coverage: entry.totalTasks > 0 ? Number((entry.dryRunTasks / entry.totalTasks).toFixed(2)) : 0,
      }))
      .sort((a, b) => b.coverage - a.coverage || b.dryRunTasks - a.dryRunTasks || a.key.localeCompare(b.key));
  }

  _deriveDryRunSuccessList(tasks = []) {
    const byProject = new Map();
    for (const task of tasks) {
      if ((task.dryRuns || []).length === 0) {
        continue;
      }
      const key = task.projectId || 'unknown';
      const current = byProject.get(key) || { key, dryRunTasks: 0, successfulTasks: 0 };
      current.dryRunTasks += 1;
      if (task.status === 'completed' || task.status === 'approved') {
        current.successfulTasks += 1;
      }
      byProject.set(key, current);
    }

    return [...byProject.values()]
      .map((entry) => ({
        ...entry,
        successRate: entry.dryRunTasks > 0 ? Number((entry.successfulTasks / entry.dryRunTasks).toFixed(2)) : 0,
      }))
      .sort((a, b) => b.successRate - a.successRate || b.successfulTasks - a.successfulTasks || a.key.localeCompare(b.key));
  }

  _deriveDryRunRecoveryComparison(tasks = []) {
    const byProject = new Map();
    for (const task of tasks) {
      if (!task.retry) {
        continue;
      }

      const key = task.projectId || 'unknown';
      const current = byProject.get(key) || {
        key,
        dryRunRetries: 0,
        dryRunResolved: 0,
        nonDryRunRetries: 0,
        nonDryRunResolved: 0,
      };
      const hasDryRun = (task.dryRuns || []).length > 0;
      const isResolved = task.status === 'completed' || task.status === 'approved';

      if (hasDryRun) {
        current.dryRunRetries += 1;
        if (isResolved) {
          current.dryRunResolved += 1;
        }
      } else {
        current.nonDryRunRetries += 1;
        if (isResolved) {
          current.nonDryRunResolved += 1;
        }
      }

      byProject.set(key, current);
    }

    return [...byProject.values()]
      .map((entry) => ({
        ...entry,
        dryRunRate: entry.dryRunRetries > 0 ? Number((entry.dryRunResolved / entry.dryRunRetries).toFixed(2)) : 0,
        nonDryRunRate: entry.nonDryRunRetries > 0 ? Number((entry.nonDryRunResolved / entry.nonDryRunRetries).toFixed(2)) : 0,
      }))
      .sort((a, b) => {
        const totalRetriesA = a.dryRunRetries + a.nonDryRunRetries;
        const totalRetriesB = b.dryRunRetries + b.nonDryRunRetries;
        if (totalRetriesB !== totalRetriesA) {
          return totalRetriesB - totalRetriesA;
        }
        return a.key.localeCompare(b.key);
      });
  }

  _deriveDryRunImpact(task = {}) {
    const hasRetry = Boolean(task.retry);
    const hasDryRun = (task.dryRuns || []).length > 0;
    const resolved = task.status === 'completed' || task.status === 'approved';

    if (hasRetry && hasDryRun && resolved) {
      return 'dry-run helped recovery';
    }
    if (hasRetry && hasDryRun) {
      return 'dry-run rehearsed, recovery pending';
    }
    if (hasRetry && resolved) {
      return 'recovered without dry-run';
    }
    if (hasDryRun) {
      return 'dry-run recorded';
    }
    return 'no dry-run signal';
  }

  _derivePromotionSignal(task = {}, latestKnowledge = null) {
    if (this._deriveDryRunImpact(task) === 'dry-run helped recovery' && latestKnowledge?.title) {
      return 'ready to promote';
    }
    if (latestKnowledge?.title) {
      return 'knowledge captured';
    }
    return 'awaiting capture';
  }

  _deriveDryRunSummaryWinRates(tasks = []) {
    const byPlay = new Map();
    for (const task of tasks) {
      const summary = task.dryRuns?.at(-1)?.summary;
      const category = task.retry?.category;
      if (!summary || !category) {
        continue;
      }

      const key = `${category} :: ${summary}`;
      const current = byPlay.get(key) || {
        key,
        category,
        summary,
        attempts: 0,
        wins: 0,
      };
      current.attempts += 1;
      if (task.status === 'completed' || task.status === 'approved') {
        current.wins += 1;
      }
      byPlay.set(key, current);
    }

    return [...byPlay.values()]
      .map((entry) => ({
        ...entry,
        winRate: entry.attempts > 0 ? Number((entry.wins / entry.attempts).toFixed(2)) : 0,
      }))
      .sort((a, b) => {
        if (b.winRate !== a.winRate) {
          return b.winRate - a.winRate;
        }
        if (b.attempts !== a.attempts) {
          return b.attempts - a.attempts;
        }
        return a.key.localeCompare(b.key);
      })
      .slice(0, 6);
  }

  _serveDashboard(req, res) {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(DASHBOARD_HTML);
  }

  getState() {
    return { ...this.agentState };
  }
}

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Kingdom Operating Console</title>
<style>
  :root {
    --bg: #f4efe6;
    --panel: rgba(255, 251, 245, 0.82);
    --ink: #1f2a24;
    --muted: #5c655f;
    --line: rgba(31, 42, 36, 0.12);
    --work: #0f766e;
    --exec: #9a3412;
    --knowledge: #1d4ed8;
    --gov: #7c3aed;
    --accent: #b45309;
    --danger: #b91c1c;
    --ok: #15803d;
    --warn: #b45309;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: Georgia, "Iowan Old Style", serif;
    color: var(--ink);
    background:
      radial-gradient(circle at top left, rgba(180, 83, 9, 0.10), transparent 28%),
      radial-gradient(circle at top right, rgba(29, 78, 216, 0.10), transparent 24%),
      linear-gradient(180deg, #fbf7f1 0%, var(--bg) 100%);
    min-height: 100vh;
  }
  .shell {
    max-width: 1440px;
    margin: 0 auto;
    padding: 32px 24px 48px;
  }
  .hero {
    display: grid;
    grid-template-columns: 1.3fr 0.7fr;
    gap: 20px;
    margin-bottom: 24px;
  }
  .panel {
    background: var(--panel);
    backdrop-filter: blur(14px);
    border: 1px solid var(--line);
    border-radius: 22px;
    box-shadow: 0 24px 50px rgba(31, 42, 36, 0.08);
  }
  .hero-main {
    padding: 28px;
  }
  .eyebrow {
    text-transform: uppercase;
    letter-spacing: 0.18em;
    font-size: 12px;
    color: var(--muted);
    margin-bottom: 12px;
  }
  h1 {
    margin: 0;
    font-size: clamp(36px, 5vw, 64px);
    line-height: 0.95;
    max-width: 12ch;
  }
  .subtitle {
    margin-top: 14px;
    max-width: 60ch;
    color: var(--muted);
    font-size: 16px;
    line-height: 1.55;
  }
  .hero-side {
    padding: 24px;
    display: grid;
    gap: 16px;
    align-content: start;
  }
  .stat-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }
  .stat-card {
    padding: 14px;
    border-radius: 16px;
    background: rgba(255,255,255,0.55);
    border: 1px solid var(--line);
  }
  .stat-label { font-size: 12px; text-transform: uppercase; letter-spacing: 0.12em; color: var(--muted); }
  .stat-value { margin-top: 8px; font-size: 28px; font-weight: 700; }
  .plane-strip {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 10px;
    margin-bottom: 24px;
  }
  .plane {
    padding: 14px 16px;
    border-radius: 18px;
    color: #fff;
    min-height: 108px;
  }
  .plane h3 { margin: 0 0 8px; font-size: 16px; }
  .plane p { margin: 0; font-size: 13px; line-height: 1.5; opacity: 0.92; }
  .work { background: linear-gradient(135deg, #115e59, var(--work)); }
  .execution { background: linear-gradient(135deg, #c2410c, var(--exec)); }
  .knowledge { background: linear-gradient(135deg, #1e40af, var(--knowledge)); }
  .governance { background: linear-gradient(135deg, #6d28d9, var(--gov)); }
  .content {
    display: grid;
    grid-template-columns: minmax(0, 1.15fr) minmax(320px, 0.85fr);
    gap: 20px;
  }
  .task-board {
    margin-bottom: 20px;
  }
  .task-board-toolbar {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 14px;
  }
  .task-filter {
    border: 1px solid var(--line);
    background: rgba(255,255,255,0.72);
    color: var(--ink);
    border-radius: 999px;
    padding: 8px 12px;
    font: inherit;
    cursor: pointer;
  }
  .task-filter.active {
    background: var(--ink);
    color: #fff;
  }
  .focus-strip {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin: 0 0 14px;
  }
  .focus-pill {
    border-radius: 999px;
    border: 1px solid rgba(29, 78, 216, 0.24);
    background: rgba(29, 78, 216, 0.10);
    color: var(--knowledge);
    padding: 7px 12px;
    font-size: 13px;
  }
  .section { padding: 22px; }
  .section-header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 12px;
    margin-bottom: 18px;
  }
  .section-title { margin: 0; font-size: 22px; }
  .section-note { color: var(--muted); font-size: 13px; }
  #agents {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 14px;
  }
  #tasks {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 14px;
  }
  .agent-card {
    background: rgba(255,255,255,0.7);
    border: 1px solid var(--line);
    border-radius: 18px;
    padding: 16px;
  }
  .agent-card h3 { margin: 0 0 12px; font-size: 18px; }
  .field { display: flex; justify-content: space-between; gap: 12px; padding: 4px 0; font-size: 14px; }
  .label { color: var(--muted); }
  .value { text-align: right; }
  .task-card {
    background: rgba(255,255,255,0.7);
    border: 1px solid var(--line);
    border-radius: 18px;
    padding: 16px;
  }
  .task-card h3 { margin: 0 0 10px; font-size: 17px; }
  .ok { color: var(--ok); }
  .warn { color: var(--warn); }
  .danger { color: var(--danger); }
  #events { display: grid; gap: 10px; max-height: 720px; overflow-y: auto; }
  .event {
    padding: 14px 16px;
    border-radius: 16px;
    border: 1px solid var(--line);
    background: rgba(255,255,255,0.72);
  }
  .event-meta { font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
  .event-body { margin-top: 8px; font-size: 14px; line-height: 1.5; }
  .knowledge-feed {
    margin-top: 18px;
    padding-top: 18px;
    border-top: 1px solid var(--line);
  }
  .task-feed {
    margin-top: 18px;
    padding-top: 18px;
    border-top: 1px solid var(--line);
  }
  .feed-list {
    display: grid;
    gap: 10px;
    margin-top: 12px;
  }
  .feed-item {
    padding: 12px 14px;
    border-radius: 14px;
    border: 1px solid var(--line);
    background: rgba(255,255,255,0.6);
  }
  .pressure-grid {
    display: grid;
    gap: 10px;
    margin-top: 18px;
    padding-top: 18px;
    border-top: 1px solid var(--line);
  }
  .pressure-card {
    padding: 12px 14px;
    border-radius: 14px;
    border: 1px solid var(--line);
    background: rgba(255,255,255,0.6);
  }
  .pressure-button {
    width: 100%;
    text-align: left;
    cursor: pointer;
  }
  .feed-title { font-size: 14px; font-weight: 700; }
  .feed-meta { margin-top: 4px; color: var(--muted); font-size: 12px; }
  @media (max-width: 980px) {
    .hero, .content, .plane-strip { grid-template-columns: 1fr; }
    .shell { padding: 20px 16px 36px; }
  }
</style>
</head>
<body>
<div class="shell">
  <section class="hero">
    <div class="panel hero-main">
      <div class="eyebrow">Kingdom • Real-World Agentic Operating System</div>
      <h1>Operating Console for Work, Memory, and Recovery</h1>
      <p class="subtitle">This console tracks the live state of Kingdom across planning, execution, knowledge, and governance. It is not a game HUD anymore. It is the control surface for real-world collaborative development.</p>
    </div>
    <aside class="panel hero-side">
      <div class="stat-grid">
        <div class="stat-card">
          <div class="stat-label">Agents Online</div>
          <div id="stat-agents" class="stat-value">0</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Live Events</div>
          <div id="stat-events" class="stat-value">0</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Health Signals</div>
          <div id="stat-health" class="stat-value">0</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Governance Alerts</div>
          <div id="stat-alerts" class="stat-value">0</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Knowledge Captures</div>
          <div id="stat-captures" class="stat-value">0</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Skill Evals</div>
          <div id="stat-skill-evals" class="stat-value">0</div>
        </div>
      </div>
      <div class="knowledge-feed">
        <div class="section-header">
          <h2 class="section-title">Knowledge Feed</h2>
          <div class="section-note">Recent captures and skill evaluation outcomes</div>
        </div>
        <div id="knowledge-feed" class="feed-list"></div>
      </div>
      <div class="task-feed">
        <div class="section-header">
          <h2 class="section-title">Task Closeout Feed</h2>
          <div class="section-note">Recent completion, review, and retry outcomes</div>
        </div>
        <div id="task-feed" class="feed-list"></div>
      </div>
      <div class="task-feed">
        <div class="section-header">
          <h2 class="section-title">Promotion Feed</h2>
          <div class="section-note">Queued and applied promotion candidates from recovery wins</div>
        </div>
        <div id="promotion-feed" class="feed-list"></div>
      </div>
      <div class="pressure-grid">
        <div class="section-header">
          <h2 class="section-title">Retry Pressure</h2>
          <div class="section-note">Where retries cluster and which guardrails resolve over time</div>
        </div>
        <div class="pressure-card">
          <div class="feed-title">Category Load</div>
          <div id="retry-category" class="feed-list"></div>
        </div>
        <div class="pressure-card">
          <div class="feed-title">Guardrail Heat</div>
          <div id="retry-guardrail" class="feed-list"></div>
        </div>
        <div class="pressure-card">
          <div class="feed-title">Resolved Guardrails</div>
          <div id="resolved-guardrail" class="feed-list"></div>
        </div>
        <div class="pressure-card">
          <div class="feed-title">Project Hotspots</div>
          <div id="retry-project" class="feed-list"></div>
        </div>
        <div class="pressure-card">
          <div class="feed-title">Task Hotspots</div>
          <div id="retry-task" class="feed-list"></div>
        </div>
        <div class="pressure-card">
          <div class="feed-title">Project Recovery Rate</div>
          <div id="project-recovery-rate" class="feed-list"></div>
        </div>
        <div class="pressure-card">
          <div class="feed-title">Task Recovery Rate</div>
          <div id="task-recovery-rate" class="feed-list"></div>
        </div>
        <div class="pressure-card">
          <div class="feed-title">Project Dry-Run Coverage</div>
          <div id="project-dry-run-coverage" class="feed-list"></div>
        </div>
        <div class="pressure-card">
          <div class="feed-title">Dry-Run Assisted Wins</div>
          <div id="project-dry-run-success" class="feed-list"></div>
        </div>
        <div class="pressure-card">
          <div class="feed-title">Dry-Run Recovery Gap</div>
          <div id="project-dry-run-recovery-gap" class="feed-list"></div>
        </div>
        <div class="pressure-card">
          <div class="feed-title">Winning Dry-Run Plays</div>
          <div id="dry-run-summary-wins" class="feed-list"></div>
        </div>
      <div class="pressure-card">
          <div class="feed-title">Promotion Queue</div>
          <div id="promotion-queue" class="feed-list"></div>
        </div>
        <div class="pressure-card">
          <div class="feed-title">Applied Promotions</div>
          <div id="promotion-applied" class="feed-list"></div>
        </div>
        <div class="pressure-card">
          <div class="feed-title">Promotion Targets</div>
          <div id="promotion-targets" class="feed-list"></div>
        </div>
        <div class="pressure-card">
          <div class="feed-title">NotebookLM Queue</div>
          <div id="notebooklm-queue" class="feed-list"></div>
        </div>
        <div class="pressure-card">
          <div class="feed-title">NotebookLM Lifecycle</div>
          <div class="feed-meta">queued, claimed, prepared, ingested</div>
          <div id="notebooklm-lifecycle" class="feed-list"></div>
        </div>
      </div>
    </aside>
  </section>

  <section class="plane-strip">
    <div class="plane work"><h3>Work Plane</h3><p>Intake, planning, decomposition, and project flow.</p></div>
    <div class="plane execution"><h3>Execution Plane</h3><p>Dispatch, swarm orchestration, deployment, and runtime action.</p></div>
    <div class="plane knowledge"><h3>Knowledge Plane</h3><p>Skills, captures, rumination, zettelkasten evolution, GoT reasoning, and eval signals.</p></div>
    <div class="plane governance"><h3>Governance Plane</h3><p>Review requests, approvals, rejections, failures, and recovery.</p></div>
  </section>

  <section class="content">
    <div class="panel section">
      <div class="task-board">
        <div class="section-header">
          <h2 class="section-title">Task Board</h2>
          <div class="section-note">Current lifecycle state from stored task configs</div>
        </div>
        <div class="task-board-toolbar">
          <button type="button" class="task-filter active" data-filter="all">All Tasks</button>
          <button type="button" class="task-filter" data-filter="retry">Retry Ready</button>
          <button type="button" class="task-filter" data-filter="blocked">Blocked</button>
          <button type="button" class="task-filter" data-filter="dry-run-wins">Dry-Run Wins</button>
          <button type="button" class="task-filter" data-filter="ready-to-promote">Ready to Promote</button>
          <button type="button" class="task-filter" data-filter="clear-focus">Reset Focus</button>
        </div>
        <div id="task-focus" class="focus-strip"></div>
        <div id="tasks"></div>
      </div>
      <div class="section-header">
        <h2 class="section-title">Agent Constellation</h2>
        <div class="section-note">Current system heartbeat and responsibilities</div>
      </div>
      <div id="agents"></div>
    </div>
    <div class="panel section">
      <div class="section-header">
        <h2 class="section-title">Event Ledger</h2>
        <div class="section-note">Newest activity, learning, and governance signals first</div>
      </div>
      <div id="events"></div>
    </div>
  </section>
</div>
<script>
const agentsDiv = document.getElementById('agents');
const tasksDiv = document.getElementById('tasks');
const taskFilters = Array.from(document.querySelectorAll('.task-filter'));
const eventsDiv = document.getElementById('events');
const taskFocusDiv = document.getElementById('task-focus');
const statAgents = document.getElementById('stat-agents');
const statEvents = document.getElementById('stat-events');
const statHealth = document.getElementById('stat-health');
const statAlerts = document.getElementById('stat-alerts');
const statCaptures = document.getElementById('stat-captures');
const statSkillEvals = document.getElementById('stat-skill-evals');
const knowledgeFeedDiv = document.getElementById('knowledge-feed');
const taskFeedDiv = document.getElementById('task-feed');
const promotionFeedDiv = document.getElementById('promotion-feed');
const retryCategoryDiv = document.getElementById('retry-category');
const retryGuardrailDiv = document.getElementById('retry-guardrail');
const resolvedGuardrailDiv = document.getElementById('resolved-guardrail');
const retryProjectDiv = document.getElementById('retry-project');
const retryTaskDiv = document.getElementById('retry-task');
const projectRecoveryRateDiv = document.getElementById('project-recovery-rate');
const taskRecoveryRateDiv = document.getElementById('task-recovery-rate');
const projectDryRunCoverageDiv = document.getElementById('project-dry-run-coverage');
const projectDryRunSuccessDiv = document.getElementById('project-dry-run-success');
const projectDryRunRecoveryGapDiv = document.getElementById('project-dry-run-recovery-gap');
const dryRunSummaryWinsDiv = document.getElementById('dry-run-summary-wins');
const promotionQueueDiv = document.getElementById('promotion-queue');
const promotionAppliedDiv = document.getElementById('promotion-applied');
const promotionTargetsDiv = document.getElementById('promotion-targets');
const notebooklmQueueDiv = document.getElementById('notebooklm-queue');
const notebooklmLifecycleDiv = document.getElementById('notebooklm-lifecycle');
const state = {};
const tasks = {};
const metrics = {
  knowledgeCaptures: 0,
  skillEvals: 0,
  recentKnowledge: [],
  recentPromotions: [],
  recentTasks: [],
  retryByCategory: {},
  retryByGuardrail: {},
  retryByProject: {},
  retryByTask: {},
  resolvedGuardrails: {},
  resolvedByProject: {},
  resolvedByTask: {},
  projectRecoveryRates: [],
  taskRecoveryRates: [],
  projectDryRunCoverage: [],
  projectDryRunSuccessRates: [],
  projectDryRunRecoveryComparison: [],
  dryRunSummaryWinRates: [],
  promotionCandidates: [],
  promotionQueueCounts: {},
  promotionAppliedCount: 0,
  promotionConversionCounts: {},
  notebooklmQueueCount: 0,
  notebooklmQueueCounts: {},
};
let totalEvents = 0;
let totalHealthSignals = 0;
let totalAlerts = 0;
const initialQuery = parseDashboardQueryClient(new URLSearchParams(window.location.search));
let activeTaskFilter = initialQuery.filter;
let activeDrilldown = initialQuery.drilldown;

taskFilters.forEach((item) => {
  item.classList.toggle('active', item.dataset.filter === activeTaskFilter);
});

for (const button of taskFilters) {
  button.addEventListener('click', () => {
    const nextFilter = button.dataset.filter || 'all';
    if (nextFilter === 'clear-focus') {
      activeDrilldown = null;
      activeTaskFilter = 'all';
    } else {
      activeTaskFilter = nextFilter;
    }
    for (const item of taskFilters) {
      item.classList.toggle('active', item === button && nextFilter !== 'clear-focus');
    }
    if (nextFilter === 'clear-focus') {
      taskFilters.forEach((item) => item.classList.toggle('active', item.dataset.filter === 'all'));
    }
    syncBrowserState();
    renderTasks();
  });
}

const es = new EventSource('/events');
es.onmessage = (e) => {
  const evt = JSON.parse(e.data);
  if (evt.type === 'connected') return;
  totalEvents += 1;

  if (evt.agentId) {
    state[evt.agentId] = { ...state[evt.agentId], [evt.type]: evt.data, lastUpdate: Date.now() };
    if (evt.type === 'health') totalHealthSignals += 1;
    renderAgents();
  }

  if (evt.type === 'safety' || evt.type === 'leader') totalAlerts += 1;
  if (evt.type === 'knowledge-capture') {
    metrics.knowledgeCaptures += 1;
    if (evt.data?.outcome === 'passed' && evt.data?.retryGuardrail) {
      incrementBucket(metrics.resolvedGuardrails, evt.data.retryGuardrail);
      incrementBucket(metrics.resolvedByProject, evt.data?.projectId || 'unknown');
      incrementBucket(metrics.resolvedByTask, buildTaskMetricKey(evt.data?.projectId, evt.data?.taskId || evt.data?.continuationTaskId));
    }
    pushKnowledgeFeed({
      type: 'capture',
      title: evt.data?.title || 'Knowledge capture',
      outcome: evt.data?.outcome || 'passed',
      detail: evt.data?.improvementNote || evt.data?.retryGuardrail || evt.data?.projectId || 'project',
    });
  }
  if (evt.type === 'skill-eval') {
    metrics.skillEvals += 1;
    pushKnowledgeFeed({
      type: 'skill-eval',
      title: evt.data?.skillName || 'Skill eval',
      outcome: evt.data?.passed ? 'passed' : 'failed',
      detail: 'score ' + (evt.data?.score ?? '?'),
    });
  }
  if (evt.type === 'task-closeout') {
    if (evt.channel === 'governance:failure:retry-requested') {
      incrementBucket(metrics.retryByCategory, evt.data?.category || 'unknown');
      incrementBucket(metrics.retryByGuardrail, evt.data?.guardrail || 'unknown');
      incrementBucket(metrics.retryByProject, evt.data?.projectId || 'unknown');
      incrementBucket(metrics.retryByTask, buildTaskMetricKey(evt.data?.projectId, evt.data?.taskId));
    }
    rememberTaskState(evt);
    pushTaskFeed({
      type: evt.channel?.split(':').slice(1).join('-') || 'task',
      title: evt.data?.taskId || 'task',
      outcome: evt.data?.feedback ? 'rejected' : (evt.data?.guardrail ? 'retry' : evt.channel?.split(':').at(-1) || 'updated'),
      detail: evt.data?.file || evt.data?.guardrail || evt.data?.projectId || '',
    });
  }
  addEvent(evt);
  renderTasks();
  renderStats();
};

function renderStats() {
  statAgents.textContent = Object.keys(state).length;
  statEvents.textContent = totalEvents;
  statHealth.textContent = totalHealthSignals;
  statAlerts.textContent = totalAlerts;
  statCaptures.textContent = metrics.knowledgeCaptures;
  statSkillEvals.textContent = metrics.skillEvals;
  renderKnowledgeFeed();
  renderTaskFeed();
  renderPromotionFeed();
  renderRetryPressure();
}

function renderAgents() {
  const entries = Object.entries(state);
  statAgents.textContent = entries.length;
  agentsDiv.innerHTML = entries.map(([id, s]) => {
    const hp = s.health?.health ?? s.status?.health ?? '?';
    const hpClass = hp > 10 ? 'ok' : hp > 5 ? 'warn' : 'danger';
    const task = s.status?.task || s.health?.task || 'No active task';
    const plane = inferPlane(task, s);
    return '<article class="agent-card"><h3>' + id + '</h3>'
      + field('Plane', plane)
      + field('Health', '<span class="' + hpClass + '">' + hp + '/20</span>')
      + field('Task', escapeHtml(task))
      + field('Food', (s.health?.food ?? '?') + '/20')
      + field('Iteration', s.react?.iteration ?? '-')
      + field('Updated', timeAgo(s.lastUpdate))
      + '</article>';
  }).join('');
}

function renderTasks() {
  const entries = Object.entries(tasks);
  const filtered = entries.filter(([, task]) => matchesTaskFilter(task));
  renderTaskFocus();
  if (filtered.length === 0) {
    tasksDiv.innerHTML = '<article class="task-card"><h3>No tasks yet</h3><div class="field"><span class="label">Status</span><span class="value">Waiting for task state</span></div></article>';
    return;
  }

  tasksDiv.innerHTML = filtered
    .sort((a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0))
    .map(([, task]) => {
      return '<article class="task-card"><h3>' + escapeHtml(task.taskId || 'task') + '</h3>'
        + field('Project', escapeHtml(task.projectId || 'unknown'))
        + field('Status', escapeHtml(task.status || 'unknown'))
        + field('Goal', escapeHtml(task.goal || 'n/a'))
        + field('Review', escapeHtml(task.review?.status || '-'))
        + field('Retry', escapeHtml(task.retry?.handoff?.status || task.retry?.guardrail || '-'))
        + field('Dry Run Count', escapeHtml(String(task.dryRuns?.length || 0)))
        + field('Latest Dry Run', escapeHtml(task.dryRuns?.at(-1)?.summary || '-'))
        + field('Dry-Run Impact', escapeHtml(task.dryRunImpact || 'no dry-run signal'))
        + field('Knowledge Capture', escapeHtml(task.latestKnowledge?.title || '-'))
        + field('Promotion Signal', escapeHtml(task.promotionSignal || 'awaiting capture'))
        + field('Latest Lesson', escapeHtml(task.latestKnowledge?.lesson || '-'))
        + field('Latest Improvement', escapeHtml(task.latestKnowledge?.improvementNote || '-'))
        + field('Knowledge Updated', timeAgo(Date.parse(task.latestKnowledge?.capturedAt || 0)))
        + field('Updated', timeAgo(task.updatedAt))
        + '</article>';
    }).join('');
}

function matchesTaskFilter(task) {
  if (activeDrilldown) {
    if (activeDrilldown.type === 'project' && task.projectId !== activeDrilldown.value) {
      return false;
    }
    if (activeDrilldown.type === 'task' && buildTaskMetricKey(task.projectId, task.taskId) !== activeDrilldown.value) {
      return false;
    }
    if (activeDrilldown.type === 'guardrail' && task.retry?.guardrail !== activeDrilldown.value) {
      return false;
    }
    if (activeDrilldown.type === 'category' && task.retry?.category !== activeDrilldown.value) {
      return false;
    }
    if (activeDrilldown.type === 'play' && (
      task.retry?.category !== activeDrilldown.category
      || task.dryRuns?.at(-1)?.summary !== activeDrilldown.value
    )) {
      return false;
    }
  }

  if (activeTaskFilter === 'retry') {
    return task.status === 'retry_requested'
      || task.status === 'replanning'
      || task.retry?.handoff?.status === 'queued'
      || task.retry?.handoff?.status === 'claimed';
  }

  if (activeTaskFilter === 'blocked') {
    return task.status === 'changes_requested' || task.review?.status === 'rejected';
  }

  if (activeTaskFilter === 'dry-run-wins') {
    return task.dryRunImpact === 'dry-run helped recovery';
  }

  if (activeTaskFilter === 'ready-to-promote') {
    return task.promotionSignal === 'ready to promote';
  }

  return true;
}

function renderTaskFocus() {
  if (!activeDrilldown) {
    taskFocusDiv.innerHTML = '<div class="section-note">Click a retry pressure bucket to focus the board by project, task, category, or guardrail.</div>';
    return;
  }

  taskFocusDiv.innerHTML = '<div class="focus-pill">Focused by '
    + escapeHtml(activeDrilldown.type)
    + ': '
    + escapeHtml(
      activeDrilldown.type === 'play'
        ? activeDrilldown.category + ' • ' + activeDrilldown.value
        : activeDrilldown.value
    )
    + '</div>';
}

function inferPlane(task, state) {
  const text = JSON.stringify({ task, state }).toLowerCase();
  if (text.includes('review') || text.includes('failure') || text.includes('guardrail')) return 'Governance';
  if (text.includes('skill') || text.includes('rumination') || text.includes('got')) return 'Knowledge';
  if (text.includes('spawn') || text.includes('deploy') || text.includes('dispatch')) return 'Execution';
  return 'Work';
}

function field(l, v) { return '<div class="field"><span class="label">' + l + '</span><span class="value">' + v + '</span></div>'; }

function addEvent(evt) {
  const div = document.createElement('div');
  div.className = 'event';
  const meta = document.createElement('div');
  meta.className = 'event-meta';
  meta.textContent = new Date().toLocaleTimeString() + ' • ' + (evt.channel || evt.type || 'event');
  const body = document.createElement('div');
  body.className = 'event-body';
  body.textContent = JSON.stringify(evt.data || evt).slice(0, 240);
  div.appendChild(meta);
  div.appendChild(body);
  eventsDiv.prepend(div);
  while (eventsDiv.children.length > 120) eventsDiv.lastChild.remove();
}

function pushKnowledgeFeed(entry) {
  metrics.recentKnowledge.unshift({ ...entry, timestamp: Date.now() });
  metrics.recentKnowledge = metrics.recentKnowledge.slice(0, 6);
}

function renderKnowledgeFeed() {
  if (metrics.recentKnowledge.length === 0) {
    knowledgeFeedDiv.innerHTML = '<div class="feed-item"><div class="feed-title">No knowledge signals yet</div><div class="feed-meta">New captures and skill evaluations will appear here.</div></div>';
    return;
  }

  knowledgeFeedDiv.innerHTML = metrics.recentKnowledge.map((entry) => {
    return '<div class="feed-item">'
      + '<div class="feed-title">' + escapeHtml(entry.title || entry.type) + '</div>'
      + '<div class="feed-meta">' + escapeHtml((entry.type || 'knowledge') + ' • ' + (entry.outcome || 'n/a') + ' • ' + (entry.detail || entry.projectId || '') + ' • ' + timeAgo(entry.timestamp)) + '</div>'
      + '</div>';
  }).join('');
}

function pushTaskFeed(entry) {
  metrics.recentTasks.unshift({ ...entry, timestamp: Date.now() });
  metrics.recentTasks = metrics.recentTasks.slice(0, 6);
}

function incrementBucket(bucket, key) {
  bucket[key] = (bucket[key] || 0) + 1;
}

function rememberTaskState(evt) {
  const taskId = evt.data?.taskId;
  const projectId = evt.data?.projectId;
  if (!taskId || !projectId) return;
  const key = projectId + ':' + taskId;
  const current = tasks[key] || { projectId, taskId };

  if (evt.channel === 'governance:task:completed') {
    tasks[key] = { ...current, status: 'completed', updatedAt: Date.now() };
    return;
  }
  if (evt.channel === 'governance:review:requested') {
    tasks[key] = {
      ...current,
      status: current.status || 'completed',
      review: { status: 'requested', file: evt.data?.file },
      updatedAt: Date.now(),
    };
    return;
  }
  if (evt.channel === 'governance:review:approved') {
    tasks[key] = {
      ...current,
      status: 'approved',
      review: { status: 'approved', file: evt.data?.file },
      updatedAt: Date.now(),
    };
    return;
  }
  if (evt.channel === 'governance:review:rejected') {
    tasks[key] = {
      ...current,
      status: 'changes_requested',
      review: { status: 'rejected', file: evt.data?.file, feedback: evt.data?.feedback },
      updatedAt: Date.now(),
    };
    return;
  }
  if (evt.channel === 'governance:failure:retry-requested') {
    tasks[key] = {
      ...current,
      status: 'retry_requested',
      retry: {
        ...(current.retry || {}),
        guardrail: evt.data?.guardrail,
        category: evt.data?.category,
        handoff: { status: 'queued', channel: 'work:intake' },
      },
      updatedAt: Date.now(),
    };
  }
}

function renderTaskFeed() {
  if (metrics.recentTasks.length === 0) {
    taskFeedDiv.innerHTML = '<div class="feed-item"><div class="feed-title">No closeout signals yet</div><div class="feed-meta">Task completion, review, and retry events will appear here.</div></div>';
    return;
  }

  taskFeedDiv.innerHTML = metrics.recentTasks.map((entry) => {
    return '<div class="feed-item">'
      + '<div class="feed-title">' + escapeHtml(entry.title || entry.type) + '</div>'
      + '<div class="feed-meta">' + escapeHtml((entry.type || 'task') + ' • ' + (entry.outcome || 'n/a') + ' • ' + (entry.detail || '') + ' • ' + timeAgo(entry.timestamp)) + '</div>'
      + '</div>';
  }).join('');
}

function renderPromotionFeed() {
  if (metrics.recentPromotions.length === 0) {
    promotionFeedDiv.innerHTML = '<div class="feed-item"><div class="feed-title">No promotion signals yet</div><div class="feed-meta">Queued and applied promotion candidates will appear here.</div></div>';
    return;
  }

  promotionFeedDiv.innerHTML = metrics.recentPromotions.map((entry) => {
    return '<div class="feed-item">'
      + '<div class="feed-title">' + escapeHtml(entry.title || entry.type) + '</div>'
      + '<div class="feed-meta">' + escapeHtml((entry.type || 'promotion') + ' • ' + (entry.outcome || 'n/a') + ' • ' + (entry.detail || '') + ' • ' + timeAgo(entry.timestamp)) + '</div>'
      + '</div>';
  }).join('');
}

function renderRetryPressure() {
  renderBucket(retryCategoryDiv, metrics.retryByCategory, 'No retry categories yet', 'category');
  renderBucket(retryGuardrailDiv, metrics.retryByGuardrail, 'No guardrail pressure yet', 'guardrail');
  renderBucket(resolvedGuardrailDiv, metrics.resolvedGuardrails, 'No resolved guardrails yet', 'guardrail');
  renderBucket(retryProjectDiv, metrics.retryByProject, 'No project hotspots yet', 'project');
  renderBucket(retryTaskDiv, metrics.retryByTask, 'No task hotspots yet', 'task');
  renderRateBucket(projectRecoveryRateDiv, deriveRateList(metrics.retryByProject, metrics.resolvedByProject), 'No project recovery rates yet');
  renderRateBucket(taskRecoveryRateDiv, deriveRateList(metrics.retryByTask, metrics.resolvedByTask), 'No task recovery rates yet');
  renderSummaryRateBucket(projectDryRunCoverageDiv, metrics.projectDryRunCoverage, 'No dry-run coverage yet', 'coverage', (entry) => entry.dryRunTasks + '/' + entry.totalTasks + ' tasks rehearsed');
  renderSummaryRateBucket(projectDryRunSuccessDiv, metrics.projectDryRunSuccessRates, 'No dry-run success rates yet', 'successRate', (entry) => entry.successfulTasks + '/' + entry.dryRunTasks + ' dry-run tasks landed');
  renderRecoveryComparisonBucket(projectDryRunRecoveryGapDiv, metrics.projectDryRunRecoveryComparison, 'No dry-run recovery comparison yet');
  renderDryRunSummaryWins(dryRunSummaryWinsDiv, metrics.dryRunSummaryWinRates, 'No dry-run plays ranked yet');
  renderPromotionQueueBucket(promotionQueueDiv, metrics.promotionQueueCounts, 'No promotion queue yet');
  renderPromotionAppliedBucket(promotionAppliedDiv, metrics.promotionAppliedCount);
  renderPromotionQueueBucket(promotionTargetsDiv, metrics.promotionConversionCounts, 'No promotion targets yet');
  renderPromotionAppliedBucket(notebooklmQueueDiv, metrics.notebooklmQueueCount, 'NotebookLM queued');
  renderPromotionQueueBucket(notebooklmLifecycleDiv, metrics.notebooklmQueueCounts, 'No NotebookLM lifecycle yet');
}

function renderPromotionQueueBucket(container, counts, emptyLabel) {
  const entries = Object.entries(counts || {});
  if (entries.length === 0) {
    container.innerHTML = '<div class="feed-meta">' + escapeHtml(emptyLabel) + '</div>';
    return;
  }

  container.innerHTML = entries
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([status, count]) => '<div class="feed-item"><div class="feed-title">' + escapeHtml(status) + '</div><div class="feed-meta">' + escapeHtml(String(count) + ' candidates') + '</div></div>')
    .join('');
}

function renderPromotionAppliedBucket(container, count, label) {
  container.innerHTML = '<div class="feed-item"><div class="feed-title">' + escapeHtml(label || 'Promoted') + '</div><div class="feed-meta">' + escapeHtml(String(count || 0) + ' applied promotions') + '</div></div>';
}

function renderBucket(container, bucket, emptyLabel, drilldownType) {
  const entries = Object.entries(bucket || {}).sort((a, b) => b[1] - a[1]).slice(0, 6);
  if (entries.length === 0) {
    container.innerHTML = '<div class="feed-meta">' + escapeHtml(emptyLabel) + '</div>';
    return;
  }

  container.innerHTML = entries.map(([label, count]) => {
    return '<button type="button" class="feed-item pressure-button" data-drilldown-type="' + escapeHtml(drilldownType || '') + '" data-drilldown-value="' + escapeHtml(label) + '">'
      + '<div class="feed-title">' + escapeHtml(label) + '</div>'
      + '<div class="feed-meta">' + escapeHtml(String(count) + ' events') + '</div>'
      + '</button>';
  }).join('');

  container.querySelectorAll('.pressure-button').forEach((button) => {
    button.addEventListener('click', () => {
      activeDrilldown = {
        type: button.dataset.drilldownType,
        value: button.dataset.drilldownValue,
      };
      syncBrowserState();
      renderTasks();
    });
  });
}

function buildTaskMetricKey(projectId, taskId) {
  return (projectId || 'unknown-project') + '/' + (taskId || 'unknown-task');
}

function parseDashboardQueryClient(searchParams) {
  const filter = searchParams.get('filter') || 'all';

  if (searchParams.get('taskId')) {
    return { filter, drilldown: { type: 'task', value: searchParams.get('taskId') } };
  }
  if (searchParams.get('retryCategory') && searchParams.get('dryRunSummary')) {
    return {
      filter,
      drilldown: {
        type: 'play',
        category: searchParams.get('retryCategory'),
        value: searchParams.get('dryRunSummary'),
      },
    };
  }
  if (searchParams.get('retryGuardrail')) {
    return { filter, drilldown: { type: 'guardrail', value: searchParams.get('retryGuardrail') } };
  }
  if (searchParams.get('retryCategory')) {
    return { filter, drilldown: { type: 'category', value: searchParams.get('retryCategory') } };
  }
  if (searchParams.get('projectId')) {
    return { filter, drilldown: { type: 'project', value: searchParams.get('projectId') } };
  }

  return { filter, drilldown: null };
}

function buildDashboardStateUrlClient(basePath, filter, drilldown) {
  const params = new URLSearchParams();
  if (filter && filter !== 'all') {
    params.set('filter', filter);
  }
  if (drilldown?.type === 'project') {
    params.set('projectId', drilldown.value);
  }
  if (drilldown?.type === 'task') {
    params.set('taskId', drilldown.value);
  }
  if (drilldown?.type === 'guardrail') {
    params.set('retryGuardrail', drilldown.value);
  }
  if (drilldown?.type === 'category') {
    params.set('retryCategory', drilldown.value);
  }
  if (drilldown?.type === 'play') {
    params.set('retryCategory', drilldown.category);
    params.set('dryRunSummary', drilldown.value);
  }

  const query = params.toString();
  return query ? basePath + '?' + query : basePath;
}

function syncTaskFilterButtons() {
  taskFilters.forEach((item) => {
    item.classList.toggle('active', item.dataset.filter === activeTaskFilter);
  });
}

function syncBrowserState() {
  const nextUrl = buildDashboardStateUrlClient('/', activeTaskFilter, activeDrilldown);
  history.replaceState({}, '', nextUrl);
}

function deriveRateList(retryBucket, resolvedBucket) {
  return Object.entries(retryBucket || {})
    .map(([key, retries]) => {
      const resolved = (resolvedBucket || {})[key] || 0;
      const rate = retries > 0 ? Number((resolved / retries).toFixed(2)) : 0;
      return { key, retries, resolved, rate };
    })
    .sort((a, b) => {
      if (b.rate !== a.rate) return b.rate - a.rate;
      if (b.resolved !== a.resolved) return b.resolved - a.resolved;
      return a.key.localeCompare(b.key);
    })
    .slice(0, 6);
}

function renderRateBucket(container, entries, emptyLabel) {
  if (!entries || entries.length === 0) {
    container.innerHTML = '<div class="feed-meta">' + escapeHtml(emptyLabel) + '</div>';
    return;
  }

  container.innerHTML = entries.map((entry) => {
    return '<div class="feed-item">'
      + '<div class="feed-title">' + escapeHtml(entry.key) + '</div>'
      + '<div class="feed-meta">' + escapeHtml((entry.resolved + '/' + entry.retries + ' resolved • ' + Math.round(entry.rate * 100) + '%')) + '</div>'
      + '</div>';
  }).join('');
}

function renderSummaryRateBucket(container, entries, emptyLabel, rateField, detailBuilder) {
  if (!entries || entries.length === 0) {
    container.innerHTML = '<div class="feed-meta">' + escapeHtml(emptyLabel) + '</div>';
    return;
  }

  container.innerHTML = entries.map((entry) => {
    return '<div class="feed-item">'
      + '<div class="feed-title">' + escapeHtml(entry.key) + '</div>'
      + '<div class="feed-meta">' + escapeHtml(detailBuilder(entry) + ' • ' + Math.round(entry[rateField] * 100) + '%') + '</div>'
      + '</div>';
  }).join('');
}

function renderRecoveryComparisonBucket(container, entries, emptyLabel) {
  if (!entries || entries.length === 0) {
    container.innerHTML = '<div class="feed-meta">' + escapeHtml(emptyLabel) + '</div>';
    return;
  }

  container.innerHTML = entries.map((entry) => {
    return '<div class="feed-item">'
      + '<div class="feed-title">' + escapeHtml(entry.key) + '</div>'
      + '<div class="feed-meta">' + escapeHtml(
        'dry-run ' + Math.round(entry.dryRunRate * 100) + '% (' + entry.dryRunResolved + '/' + entry.dryRunRetries + ')'
        + ' • non-dry-run ' + Math.round(entry.nonDryRunRate * 100) + '% (' + entry.nonDryRunResolved + '/' + entry.nonDryRunRetries + ')'
      ) + '</div>'
      + '</div>';
  }).join('');
}

function renderDryRunSummaryWins(container, entries, emptyLabel) {
  if (!entries || entries.length === 0) {
    container.innerHTML = '<div class="feed-meta">' + escapeHtml(emptyLabel) + '</div>';
    return;
  }

  container.innerHTML = entries.map((entry) => {
    return '<button type="button" class="feed-item pressure-button" data-drilldown-type="play" data-drilldown-category="' + escapeHtml(entry.category) + '" data-drilldown-value="' + escapeHtml(entry.summary) + '">'
      + '<div class="feed-title">' + escapeHtml(entry.category + ' • ' + entry.summary) + '</div>'
      + '<div class="feed-meta">' + escapeHtml(entry.wins + '/' + entry.attempts + ' wins • ' + Math.round(entry.winRate * 100) + '%') + '</div>'
      + '</button>';
  }).join('');

  container.querySelectorAll('.pressure-button').forEach((button) => {
    button.addEventListener('click', () => {
      activeTaskFilter = 'ready-to-promote';
      syncTaskFilterButtons();
      activeDrilldown = {
        type: 'play',
        category: button.dataset.drilldownCategory,
        value: button.dataset.drilldownValue,
      };
      syncBrowserState();
      renderTasks();
    });
  });
}

function timeAgo(ts) {
  if (!ts) return 'unknown';
  const delta = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (delta < 60) return delta + 's ago';
  if (delta < 3600) return Math.round(delta / 60) + 'm ago';
  return Math.round(delta / 3600) + 'h ago';
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

fetch(buildDashboardStateUrlClient('/api/state', activeTaskFilter, activeDrilldown)).then(r => r.json()).then(d => {
  Object.assign(state, d.agents);
  for (const task of (d.tasks || [])) {
    tasks[task.projectId + ':' + task.taskId] = task;
  }
  Object.assign(metrics, d.metrics || {});
  renderTasks();
  renderAgents();
  renderStats();
});
</script>
</body>
</html>`;

module.exports = {
  DashboardServer,
  DASHBOARD_HTML,
  parseDashboardQuery,
  buildDashboardStateUrl,
};

// Run standalone
if (require.main === module) {
  const dash = new DashboardServer();
  dash.start().catch(err => log.error('dashboard', 'start failed', { error: err.message }));
  process.on('SIGINT', async () => {
    await dash.stop();
    process.exit(0);
  });
}
