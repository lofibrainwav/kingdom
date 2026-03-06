/**
 * Octiv Dashboard Server — Phase 6.1
 * Real-time web dashboard with SSE for agent monitoring.
 * Usage: node agent/dashboard.js (port 3000)
 */
const http = require('http');
const { Blackboard } = require('../core/blackboard');
const { getLogger } = require('../core/logger');
const log = getLogger();

const PORT = process.env.DASHBOARD_PORT || 3000;

class DashboardServer {
  constructor(port = PORT) {
    this.port = port;
    this.board = new Blackboard();
    this.server = null;
    this.sseClients = [];
    this.subscriber = null;
    this.agentState = {};
    this.metrics = {
      knowledgeCaptures: 0,
      skillEvals: 0,
      lastSkillEval: null,
      recentKnowledge: [],
    };
  }

  async start() {
    await this.board.connect();
    this.subscriber = await this.board.createSubscriber();
    this.subscriber.on('error', (err) => log.error('dashboard', 'Redis sub error', { error: err.message }));
    this._subscribeUpdates();

    this.server = http.createServer((req, res) => this._handleRequest(req, res));
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
        this._rememberKnowledgeEvent({
          type: 'capture',
          title: data.title,
          outcome: data.outcome,
          projectId: data.projectId,
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
  }

  _rememberKnowledgeEvent(event) {
    this.metrics.recentKnowledge.unshift({
      ...event,
      timestamp: Date.now(),
    });
    this.metrics.recentKnowledge = this.metrics.recentKnowledge.slice(0, 6);
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

  _handleRequest(req, res) {
    if (req.url === '/events') {
      return this._handleSSE(req, res);
    }
    if (req.url === '/api/state') {
      return this._handleAPIState(req, res);
    }
    if (req.url === '/' || req.url === '/index.html') {
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

  _handleAPIState(req, res) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ agents: this.agentState, metrics: this.metrics, timestamp: Date.now() }));
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
const eventsDiv = document.getElementById('events');
const statAgents = document.getElementById('stat-agents');
const statEvents = document.getElementById('stat-events');
const statHealth = document.getElementById('stat-health');
const statAlerts = document.getElementById('stat-alerts');
const statCaptures = document.getElementById('stat-captures');
const statSkillEvals = document.getElementById('stat-skill-evals');
const knowledgeFeedDiv = document.getElementById('knowledge-feed');
const state = {};
const metrics = { knowledgeCaptures: 0, skillEvals: 0, recentKnowledge: [] };
let totalEvents = 0;
let totalHealthSignals = 0;
let totalAlerts = 0;

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
    pushKnowledgeFeed({
      type: 'capture',
      title: evt.data?.title || 'Knowledge capture',
      outcome: evt.data?.outcome || 'passed',
      detail: evt.data?.projectId || 'project',
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
  addEvent(evt);
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

fetch('/api/state').then(r => r.json()).then(d => {
  Object.assign(state, d.agents);
  Object.assign(metrics, d.metrics || {});
  renderAgents();
  renderStats();
});
</script>
</body>
</html>`;

module.exports = { DashboardServer, DASHBOARD_HTML };

// Run standalone
if (require.main === module) {
  const dash = new DashboardServer();
  dash.start().catch(err => log.error('dashboard', 'start failed', { error: err.message }));
  process.on('SIGINT', async () => {
    await dash.stop();
    process.exit(0);
  });
}
