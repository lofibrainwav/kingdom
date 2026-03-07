/**
 * Vault Bridge — Blackboard events → Obsidian MCP (Knowledge OS)
 *
 * Subscribes to Kingdom's Redis/Blackboard events and mirrors
 * relevant knowledge captures into the bb/ Obsidian Vault.
 *
 * Events handled:
 *   governance:task:completed          → 05-Operations/kingdom-tasks/
 *   knowledge:notebooklm:ingested      → 02-Research/
 *   knowledge:capture:stored           → 05-Operations/knowledge-captures/
 *   governance:teamlead:reviewed       → 05-Operations/teamlead-reviews/
 *   governance:teamlead:vibe-translated → 05-Operations/teamlead-vibes/
 *   knowledge:research:completed       → 02-Research/kingdom-research/
 *
 * Usage:
 *   const { VaultBridge } = require('./vault-bridge');
 *   const bridge = new VaultBridge({ board });
 *   await bridge.init();
 *   await bridge.start();
 */

const { Blackboard } = require('../core/blackboard');
const { getLogger } = require('../core/logger');

const log = getLogger();

class VaultBridge {
  constructor(options = {}) {
    this.board = options.board || new Blackboard();
    this.obsidianBase = options.obsidianBase || process.env.OBSIDIAN_BASE_URL || 'http://127.0.0.1:27124';
    this.obsidianToken = options.obsidianToken || process.env.OBSIDIAN_API_KEY || '';
    this.subscriber = null;
    this.enabled = true;
  }

  async init() {
    if (this.board.connect && this.board.client && !this.board.client.isOpen) {
      await this.board.connect();
    }
    this.enabled = !!this.obsidianToken;
    if (!this.enabled) {
      log.info('vault-bridge', 'initialized (disabled — OBSIDIAN_API_KEY not set)');
      return;
    }
    log.info('vault-bridge', 'initialized');
  }

  async start() {
    if (!this.enabled) return;
    this.subscriber = await this.board.createSubscriber();
    this.subscriber.on('error', (err) =>
      log.error('vault-bridge', 'Redis sub error', { error: err.message })
    );

    await this.subscriber.subscribe('governance:task:completed', async (message) => {
      try { await this.handleTaskCompleted(message); }
      catch (err) { log.error('vault-bridge', 'handleTaskCompleted failed', { error: err.message }); }
    });

    await this.subscriber.subscribe('knowledge:notebooklm:ingested', async (message) => {
      try { await this.handleNotebookLMIngested(message); }
      catch (err) { log.error('vault-bridge', 'handleNotebookLMIngested failed', { error: err.message }); }
    });

    await this.subscriber.subscribe('knowledge:capture:stored', async (message) => {
      try { await this.handleCaptureStored(message); }
      catch (err) { log.error('vault-bridge', 'handleCaptureStored failed', { error: err.message }); }
    });

    await this.subscriber.subscribe('governance:teamlead:reviewed', async (message) => {
      try { await this.handleTeamLeadReviewed(message); }
      catch (err) { log.error('vault-bridge', 'handleTeamLeadReviewed failed', { error: err.message }); }
    });

    await this.subscriber.subscribe('governance:teamlead:vibe-translated', async (message) => {
      try { await this.handleVibeTranslated(message); }
      catch (err) { log.error('vault-bridge', 'handleVibeTranslated failed', { error: err.message }); }
    });

    await this.subscriber.subscribe('knowledge:research:completed', async (message) => {
      try { await this.handleResearchCompleted(message); }
      catch (err) { log.error('vault-bridge', 'handleResearchCompleted failed', { error: err.message }); }
    });

    log.info('vault-bridge', 'subscribed to Blackboard events');
  }

  async shutdown() {
    if (this.subscriber && this.subscriber.disconnect) {
      await this.subscriber.disconnect();
    }
    if (this.board && this.board.disconnect && this.board.client && this.board.client.isOpen) {
      await this.board.disconnect();
    }
    log.info('vault-bridge', 'shutdown complete');
  }

  // ── Event handlers ───────────────────────────────────────────────

  async handleTaskCompleted(message) {
    const data = this._parseMessage(message);
    const timestamp = new Date().toISOString();
    const slug = this._slugify(data.taskId || 'unknown-task');

    const content = `---
source: kingdom-blackboard
event: governance:task:completed
project: "${data.projectId || 'unknown'}"
task_id: "${data.taskId || ''}"
bridged_at: "${timestamp}"
---

# Task Completed: ${data.taskId || 'Unknown'}

**Project**: ${data.projectId || 'unknown'}
**Verification Count**: ${data.verificationCount || 0}
**Completed At**: ${timestamp}

## Summary
${data.summary || 'Task completed via Kingdom governance pipeline.'}

## Bridge Info
- **Source**: Kingdom Blackboard (governance:task:completed)
- **Pipeline**: vault-bridge.js (Phase 3 automation)
`;

    await this._obsidianPut(`05-Operations/kingdom-tasks/${slug}.md`, content);
    log.info('vault-bridge', `Task mirrored: ${slug}`);
  }

  async handleNotebookLMIngested(message) {
    const data = this._parseMessage(message);
    const timestamp = new Date().toISOString();
    const slug = this._slugify(data.sourceTitle || data.sourcePath || 'ingested');

    const content = `---
source: kingdom-blackboard
event: knowledge:notebooklm:ingested
project: "${data.projectId || 'unknown'}"
bridged_at: "${timestamp}"
---

# NotebookLM Ingestion: ${data.sourceTitle || 'Unknown Source'}

**Source Path**: ${data.sourcePath || 'N/A'}
**Project**: ${data.projectId || 'unknown'}
**Ingested At**: ${timestamp}

## Details
${data.summary || 'Source was ingested into NotebookLM via Kingdom pipeline.'}

## Bridge Info
- **Source**: Kingdom Blackboard (knowledge:notebooklm:ingested)
- **Pipeline**: vault-bridge.js (Phase 3 automation)
`;

    await this._obsidianPut(`02-Research/kingdom-ingested-${slug}.md`, content);
    log.info('vault-bridge', `Ingestion mirrored: ${slug}`);
  }

  async handleCaptureStored(message) {
    const data = this._parseMessage(message);
    const timestamp = new Date().toISOString();
    const slug = this._slugify(data.title || 'capture');

    const content = `---
source: kingdom-blackboard
event: knowledge:capture:stored
project: "${data.projectId || 'unknown'}"
outcome: "${data.outcome || 'unknown'}"
bridged_at: "${timestamp}"
---

# Knowledge Capture: ${data.title || 'Unknown'}

**Author**: ${data.author || 'knowledge-operator'}
**Project**: ${data.projectId || 'unknown'}
**Outcome**: ${data.outcome || 'unknown'}
**Original Note**: ${data.notePath || 'N/A'}

## Bridge Info
- **Source**: Kingdom Blackboard (knowledge:capture:stored)
- **Pipeline**: vault-bridge.js (Phase 3 automation)
- **Retry Category**: ${data.retryCategory || 'none'}
- **Improvement**: ${data.improvementNote || 'none'}
`;

    await this._obsidianPut(`05-Operations/knowledge-captures/${slug}.md`, content);
    log.info('vault-bridge', `Capture mirrored: ${slug}`);
  }

  async handleTeamLeadReviewed(message) {
    const data = this._parseMessage(message);
    const timestamp = new Date().toISOString();
    const taskList = (data.taskIds || []).join(', ');
    const slug = this._slugify(`review-${data.projectId || 'unknown'}-${Date.now()}`);

    const content = `---
source: kingdom-blackboard
event: governance:teamlead:reviewed
project: "${data.projectId || 'unknown'}"
verdict: "${data.verdict || 'unknown'}"
bridged_at: "${timestamp}"
---

# TeamLead Review: ${data.verdict || 'Unknown'}

**Project**: ${data.projectId || 'unknown'}
**Tasks**: ${taskList || 'N/A'}
**Batch Size**: ${data.batchSize || 0}
**Scores**: Truth=${data.scores?.truth || '?'} Goodness=${data.scores?.goodness || '?'} Beauty=${data.scores?.beauty || '?'}
**Store Worthy**: ${data.storeWorthy || false}

## Summary
${data.summary || 'No summary provided.'}
`;

    await this._obsidianPut(`05-Operations/teamlead-reviews/${slug}.md`, content);
    log.info('vault-bridge', `TeamLead review mirrored: ${slug}`);
  }

  async handleVibeTranslated(message) {
    const data = this._parseMessage(message);
    const timestamp = new Date().toISOString();
    const slug = this._slugify(`vibe-${data.projectId || 'unknown'}-${Date.now()}`);

    const patterns = (data.patterns || []).map((p, i) =>
      `### Pattern ${i + 1}\n- **Intent**: ${p.intent || '?'}\n- **Gap**: ${p.gap || '?'}\n- **Guardrail**: ${p.guardrail || '?'}`
    ).join('\n\n');

    const content = `---
source: kingdom-blackboard
event: governance:teamlead:vibe-translated
project: "${data.projectId || 'unknown'}"
bridged_at: "${timestamp}"
---

# Vibe Translation: ${data.metaInsight || 'Unknown'}

**Project**: ${data.projectId || 'unknown'}
**Failure Count**: ${data.failureCount || 0}
**Tasks**: ${(data.taskIds || []).join(', ') || 'N/A'}

## Meta Insight
${data.metaInsight || 'No insight provided.'}

## Suggested Prompt Patch
\`\`\`
${data.suggestedPromptPatch || 'None'}
\`\`\`

## Failure Patterns
${patterns || 'No patterns extracted.'}
`;

    await this._obsidianPut(`05-Operations/teamlead-vibes/${slug}.md`, content);
    log.info('vault-bridge', `Vibe translation mirrored: ${slug}`);
  }

  async handleResearchCompleted(message) {
    const data = this._parseMessage(message);
    const timestamp = new Date().toISOString();
    const slug = this._slugify(data.researchId || `research-${Date.now()}`);

    const content = `---
source: kingdom-blackboard
event: knowledge:research:completed
project: "${data.projectId || 'unknown'}"
bridged_at: "${timestamp}"
---

# Research: ${(data.question || 'Unknown').slice(0, 80)}

**Project**: ${data.projectId || 'unknown'}
**Research ID**: ${data.researchId || 'N/A'}
**Grok Answer**: ${data.hasGrokAnswer ? 'Yes' : 'No'}
**NLM Answer**: ${data.hasNlmAnswer ? 'Yes' : 'No'}

## Question
${data.question || 'No question provided.'}
`;

    await this._obsidianPut(`02-Research/kingdom-research/${slug}.md`, content);
    log.info('vault-bridge', `Research mirrored: ${slug}`);
  }

  // ── Obsidian REST helpers ────────────────────────────────────────

  async _obsidianPut(filepath, content) {
    const url = `${this.obsidianBase}/vault/${encodeURIComponent(filepath)}`;
    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${this.obsidianToken}`,
        'Content-Type': 'application/markdown',
      },
      body: content,
    });
    if (!res.ok) {
      throw new Error(`Obsidian PUT ${filepath}: ${res.status}`);
    }
  }

  async _obsidianAppend(filepath, content) {
    const url = `${this.obsidianBase}/vault/${encodeURIComponent(filepath)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.obsidianToken}`,
        'Content-Type': 'application/markdown',
      },
      body: content,
    });
    if (!res.ok) {
      throw new Error(`Obsidian APPEND ${filepath}: ${res.status}`);
    }
  }

  // ── Utilities ────────────────────────────────────────────────────

  _parseMessage(message) {
    if (!message) return {};
    if (typeof message === 'string') {
      try { return JSON.parse(message); }
      catch { return {}; }
    }
    return message;
  }

  _slugify(value) {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 80);
  }
}

module.exports = { VaultBridge };
