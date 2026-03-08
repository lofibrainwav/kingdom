/**
 * Obsidian Dashboard — writes live agent state to bb/ vault as .md files.
 * Replaces HTTP dashboard with file-based Obsidian-native monitoring.
 *
 * Subscribes to Redis events → writes .md files → Obsidian auto-reloads.
 * No HTTP server, no port, no SSE. Obsidian IS the dashboard.
 *
 * Files written:
 *   bb/06-Dashboard/agent-status.md   — 17 agents real-time state
 *   bb/06-Dashboard/pipeline-flow.md  — current task pipeline progress
 *   bb/06-Dashboard/event-log.md      — recent 50 events (rolling)
 *   bb/06-Dashboard/health.md         — system health summary
 */
const fs = require('fs');
const path = require('path');
const { Blackboard } = require('../core/blackboard');
const { getLogger } = require('../core/logger');
const log = getLogger();

const BB_ROOT = path.join(__dirname, '..', '..', '..');
const DASHBOARD_DIR = path.join(BB_ROOT, '06-Dashboard');

// Throttle file writes — Obsidian doesn't need sub-second updates
const WRITE_INTERVAL_MS = 3000;

class ObsidianDashboard {
  constructor(options = {}) {
    this.board = options.board || new Blackboard();
    this.subscriber = null;
    this._dirty = new Set();
    this._writeTimer = null;

    // State mirrors
    this.agentState = {};
    this.pipelineStages = {};
    this.eventLog = [];
    this.metrics = {
      knowledgeCaptures: 0,
      skillEvals: 0,
      retryCount: 0,
      reviewsApproved: 0,
      reviewsRejected: 0,
      deploymentsCompleted: 0,
      skillTierUps: 0,
    };
    this._startedAt = null;
  }

  async init() {
    await this.board.connect();
    fs.mkdirSync(DASHBOARD_DIR, { recursive: true });
    log.info('obsidian-dashboard', `vault dir: ${DASHBOARD_DIR}`);
  }

  async start() {
    this._startedAt = Date.now();
    this.subscriber = await this.board.createSubscriber();
    this.subscriber.on('error', (err) =>
      log.error('obsidian-dashboard', 'Redis sub error', { error: err.message })
    );
    this._subscribeAll();
    this._startWriteLoop();

    // Initial write
    this._markDirty('agent-status', 'pipeline-flow', 'event-log', 'health');
    log.info('obsidian-dashboard', 'started — writing to bb/06-Dashboard/');
  }

  async shutdown() {
    if (this._writeTimer) clearInterval(this._writeTimer);
    this._flushAll();
    if (this.subscriber) {
      await this.subscriber.disconnect().catch(() => {});
    }
    // Do NOT disconnect board — it's shared via team.js.
    // team.js owns the lifecycle (forceDisconnect at shutdown).
    log.info('obsidian-dashboard', 'shutdown complete');
  }

  // ── Subscriptions ────────────────────────────────────────

  _subscribeAll() {
    // Agent heartbeats
    this.subscriber.pSubscribe('agent:*', (message, channel) => {
      try {
        const data = this._parse(message);
        const parts = channel.split(':');
        const agentId = parts[2];
        const eventType = parts.slice(3).join(':');
        this.agentState[agentId] = {
          ...this.agentState[agentId],
          [eventType]: data,
          lastUpdate: new Date().toISOString(),
        };
        this._markDirty('agent-status');
      } catch (err) {
        log.warn('obsidian-dashboard', 'agent event parse error', { error: err.message });
      }
    });

    // Pipeline stages
    const pipelineChannels = [
      'work:intake',
      'work:planning:init',
      'work:planning:designed',
      'work:planning:decomposed',
      'governance:review:requested',
      'governance:review:approved',
      'governance:review:rejected',
      'governance:project:approved',
      'execution:deployment:completed',
      'governance:failure:retry-requested',
    ];
    for (const ch of pipelineChannels) {
      this.subscriber.subscribe(ch, (message) => {
        try {
          const data = this._parse(message);
          const taskKey = `${data.projectId || '?'}/${data.taskId || '?'}`;
          this.pipelineStages[taskKey] = {
            stage: ch,
            data,
            timestamp: new Date().toISOString(),
          };
          this._pushEvent(ch, data);
          this._updateMetrics(ch, data);
          this._markDirty('pipeline-flow', 'event-log', 'health');
        } catch (err) {
          log.warn('obsidian-dashboard', 'pipeline parse error', { error: err.message });
        }
      });
    }

    // Knowledge events
    const knowledgeChannels = [
      'knowledge:capture:stored',
      'knowledge:skill:eval-completed',
      'knowledge:promotion:candidate',
      'knowledge:promotion:applied',
      'knowledge:reflexion:triggered',
      'knowledge:rumination:digested',
      'knowledge:research:completed',
      'knowledge:notebooklm:ingested',
      'knowledge:notebooklm:claimed',
      'knowledge:notebooklm:prepared',
      'team:celebration',
    ];
    for (const ch of knowledgeChannels) {
      this.subscriber.subscribe(ch, (message) => {
        try {
          const data = this._parse(message);
          this._pushEvent(ch, data);
          this._updateMetrics(ch, data);
          this._markDirty('event-log', 'health');
        } catch (err) {
          log.warn('obsidian-dashboard', 'knowledge parse error', { error: err.message });
        }
      });
    }

    // TeamLead + safety
    const govChannels = [
      'governance:teamlead:reviewed',
      'governance:teamlead:vibe-translated',
      'governance:teamlead:health-checked',
      'governance:watchdog:recovery',
      'orchestrator:registered',
      'orchestrator:deregistered',
      'config:llm:updated',
    ];
    for (const ch of govChannels) {
      this.subscriber.subscribe(ch, (message) => {
        try {
          const data = this._parse(message);
          this._pushEvent(ch, data);
          this._markDirty('event-log');
        } catch (err) {
          log.warn('obsidian-dashboard', 'gov parse error', { error: err.message });
        }
      });
    }
  }

  // ── State management ─────────────────────────────────────

  _parse(message) {
    return typeof message === 'string' ? JSON.parse(message) : message;
  }

  _pushEvent(channel, data) {
    this.eventLog.unshift({
      channel,
      summary: data.taskId || data.title || data.skillName || data.agentId || '-',
      author: data.author || '-',
      timestamp: new Date().toISOString(),
    });
    if (this.eventLog.length > 50) this.eventLog.length = 50;
  }

  _updateMetrics(channel, data) {
    if (channel === 'knowledge:capture:stored') this.metrics.knowledgeCaptures++;
    if (channel === 'knowledge:skill:eval-completed') this.metrics.skillEvals++;
    if (channel === 'governance:failure:retry-requested') this.metrics.retryCount++;
    if (channel === 'governance:review:approved') this.metrics.reviewsApproved++;
    if (channel === 'governance:review:rejected') this.metrics.reviewsRejected++;
    if (channel === 'execution:deployment:completed') this.metrics.deploymentsCompleted++;
    if (channel === 'team:celebration') this.metrics.skillTierUps++;
  }

  _markDirty(...files) {
    for (const f of files) this._dirty.add(f);
  }

  // ── Write loop ───────────────────────────────────────────

  _startWriteLoop() {
    this._writeTimer = setInterval(() => this._flushAll(), WRITE_INTERVAL_MS);
  }

  _flushAll() {
    for (const file of this._dirty) {
      try {
        const content = this._render(file);
        if (content) {
          fs.writeFileSync(path.join(DASHBOARD_DIR, `${file}.md`), content);
        }
      } catch (err) {
        log.warn('obsidian-dashboard', `write error: ${file}`, { error: err.message });
      }
    }
    this._dirty.clear();
  }

  _render(file) {
    switch (file) {
      case 'agent-status': return this._renderAgentStatus();
      case 'pipeline-flow': return this._renderPipelineFlow();
      case 'event-log': return this._renderEventLog();
      case 'health': return this._renderHealth();
      default: return null;
    }
  }

  // ── Renderers ────────────────────────────────────────────

  _renderAgentStatus() {
    const now = new Date().toISOString();
    const agents = Object.entries(this.agentState);

    let rows = '';
    if (agents.length === 0) {
      rows = '| (waiting for agent heartbeats) | - | - |\n';
    } else {
      for (const [id, state] of agents.sort((a, b) => a[0].localeCompare(b[0]))) {
        const lastEvent = Object.keys(state).filter(k => k !== 'lastUpdate').pop() || '-';
        const updated = state.lastUpdate || '-';
        rows += `| ${id} | ${lastEvent} | ${updated} |\n`;
      }
    }

    return `---
tags: [type/dashboard, source/obsidian-dashboard, status/active]
updated: "${now}"
---
# Agent Status

> Auto-updated by \`obsidian-dashboard.js\` every ${WRITE_INTERVAL_MS / 1000}s

| Agent | Last Event | Updated |
|-------|-----------|---------|
${rows}
## See Also
- [[pipeline-flow]] — Current task pipeline
- [[event-log]] — Recent events
- [[health]] — System health
`;
  }

  _renderPipelineFlow() {
    const now = new Date().toISOString();
    const tasks = Object.entries(this.pipelineStages);

    const stageLabel = {
      'work:intake': 'Intake',
      'work:planning:init': 'PM -> Architect',
      'work:planning:designed': 'Architect -> Decomposer',
      'work:planning:decomposed': 'Decomposer -> Coder',
      'governance:review:requested': 'Coder -> Reviewer',
      'governance:review:approved': 'Approved',
      'governance:review:rejected': 'Rejected -> Retry',
      'governance:project:approved': 'Closeout -> Deployer',
      'execution:deployment:completed': 'Deployed',
      'governance:failure:retry-requested': 'Retry Requested',
    };

    let rows = '';
    if (tasks.length === 0) {
      rows = '| (no active tasks) | - | - |\n';
    } else {
      // Show most recent 20 tasks
      const sorted = tasks.sort((a, b) =>
        (b[1].timestamp || '').localeCompare(a[1].timestamp || '')
      ).slice(0, 20);
      for (const [key, info] of sorted) {
        const label = stageLabel[info.stage] || info.stage;
        rows += `| ${key} | ${label} | ${info.timestamp} |\n`;
      }
    }

    return `---
tags: [type/dashboard, source/obsidian-dashboard, status/active]
updated: "${now}"
---
# Pipeline Flow

> Auto-updated by \`obsidian-dashboard.js\`

\`\`\`mermaid
graph LR
    A[Intake] --> B[PM]
    B --> C[Architect]
    C --> D[Decomposer]
    D --> E[Coder]
    E --> F[Reviewer]
    F -->|approve| G[Deployer]
    F -->|reject| H[FailureAgent]
    H --> E
    G --> I[Done]
\`\`\`

## Active Tasks

| Task | Stage | Updated |
|------|-------|---------|
${rows}
## See Also
- [[agent-status]] — Agent states
- [[event-log]] — Full event history
`;
  }

  _renderEventLog() {
    const now = new Date().toISOString();

    let rows = '';
    if (this.eventLog.length === 0) {
      rows = '| (no events yet) | - | - | - |\n';
    } else {
      for (const e of this.eventLog) {
        rows += `| ${e.timestamp.slice(11, 19)} | ${e.channel} | ${e.summary} | ${e.author} |\n`;
      }
    }

    return `---
tags: [type/dashboard, source/obsidian-dashboard, status/active]
updated: "${now}"
---
# Event Log

> Last 50 events, auto-updated by \`obsidian-dashboard.js\`

| Time | Channel | Summary | Author |
|------|---------|---------|--------|
${rows}
## See Also
- [[pipeline-flow]] — Task pipeline
- [[health]] — System metrics
`;
  }

  _renderHealth() {
    const now = new Date().toISOString();
    const uptimeMs = this._startedAt ? Date.now() - this._startedAt : 0;
    const uptimeMin = Math.floor(uptimeMs / 60000);
    const redisOk = this.board.client && this.board.client.isReady;
    const agentCount = Object.keys(this.agentState).length;

    return `---
tags: [type/dashboard, source/obsidian-dashboard, status/active]
updated: "${now}"
---
# System Health

> Auto-updated by \`obsidian-dashboard.js\`

## Status
| Metric | Value |
|--------|-------|
| Redis | ${redisOk ? 'connected' : 'disconnected'} |
| Uptime | ${uptimeMin} min |
| Agents reporting | ${agentCount} |

## Metrics
| Counter | Value |
|---------|-------|
| Knowledge captures | ${this.metrics.knowledgeCaptures} |
| Skill evaluations | ${this.metrics.skillEvals} |
| Reviews approved | ${this.metrics.reviewsApproved} |
| Reviews rejected | ${this.metrics.reviewsRejected} |
| Retries | ${this.metrics.retryCount} |
| Deployments | ${this.metrics.deploymentsCompleted} |
| Skill tier-ups | ${this.metrics.skillTierUps} |

## See Also
- [[agent-status]] — Agent states
- [[pipeline-flow]] — Pipeline progress
- [[event-log]] — Full event log
- [[kingdom/infrastructure]] — Infrastructure map
`;
  }
}

module.exports = { ObsidianDashboard, DASHBOARD_DIR, WRITE_INTERVAL_MS };
