/**
 * NotebookLM Queue Manager
 *
 * Processes the knowledge:notebooklm:queued pipeline:
 *   queued → claimed → prepared → ingested
 *
 * Steps:
 *   1. Subscribe to knowledge:notebooklm:queued
 *   2. Claim the source (publish claimed)
 *   3. Read source content from vault, prepare as NLM packet
 *   4. Write packet to 02-Research/notebooklm-packets/ (publish prepared)
 *   5. Mark as ingested (publish ingested) — actual NLM browser ingestion
 *      is handled externally by add_source.py or NotebookLM MCP
 *
 * Graceful degradation: skips if OBSIDIAN_API_KEY is not set.
 */
const fsp = require('fs').promises;
const path = require('path');
const { Blackboard } = require('../core/blackboard');
const { getLogger } = require('../core/logger');

const log = getLogger();

const DEFAULT_PACKET_DIR = path.join(__dirname, '..', 'vault', '02-Research', 'notebooklm-packets');

class NotebookLMQueue {
  constructor(options = {}) {
    this.board = options.board || new Blackboard();
    this.obsidianBase = options.obsidianBase || process.env.OBSIDIAN_BASE_URL || 'http://127.0.0.1:27124';
    this.obsidianToken = options.obsidianToken || process.env.OBSIDIAN_API_KEY || '';
    this.packetDir = options.packetDir || DEFAULT_PACKET_DIR;
    this.subscriber = null;
    this.enabled = true;
    this.processed = 0;
  }

  async init() {
    if (this.board.connect && this.board.client && !this.board.client.isOpen) {
      await this.board.connect();
    }
    this.enabled = !!this.obsidianToken;
    if (!this.enabled) {
      log.info('nlm-queue', 'initialized (disabled — OBSIDIAN_API_KEY not set)');
      return;
    }
    await fsp.mkdir(this.packetDir, { recursive: true });
    log.info('nlm-queue', 'initialized');
  }

  async start() {
    if (!this.enabled) return;
    this.subscriber = await this.board.createSubscriber();
    this.subscriber.on('error', (err) =>
      log.error('nlm-queue', 'subscriber error', { error: err.message })
    );

    await this.subscriber.subscribe('knowledge:notebooklm:queued', async (message) => {
      try {
        await this.processQueued(message);
      } catch (err) {
        log.error('nlm-queue', 'processQueued failed', { error: err.message });
      }
    });

    log.info('nlm-queue', 'subscribed to knowledge:notebooklm:queued');
  }

  async processQueued(message) {
    const data = this._parseMessage(message);
    if (!data.sourcePath && !data.taskId) {
      log.warn('nlm-queue', 'skipping queued item — no sourcePath or taskId');
      return;
    }

    const { author, projectId, taskId, sourcePath, queueType, sourceTitle } = data;

    // Step 1: Claim
    await this.board.publish('knowledge:notebooklm:claimed', {
      author: 'nlm-queue',
      projectId,
      taskId,
      sourcePath,
      queueType: queueType || 'promotion-source',
    });
    log.info('nlm-queue', `claimed: ${taskId || sourcePath}`);

    // Step 2: Read source content and prepare packet
    let content = '';
    try {
      content = await this._readSource(sourcePath);
    } catch (err) {
      log.warn('nlm-queue', `source read failed, using title as content: ${err.message}`);
      content = `# ${sourceTitle || taskId || 'Unknown Source'}\n\nSource file not accessible: ${sourcePath}`;
    }

    const slug = this._slugify(sourceTitle || taskId || 'packet');
    const packetFilename = `nlm-${slug}.md`;
    const packetPath = path.join(this.packetDir, packetFilename);

    const packet = this._renderPacket({
      sourceTitle: sourceTitle || taskId,
      sourcePath,
      projectId,
      taskId,
      content,
      queueType,
    });

    await fsp.writeFile(packetPath, packet, 'utf-8');

    // Also mirror to Obsidian vault via REST API
    try {
      await this._obsidianPut(`02-Research/notebooklm-packets/${packetFilename}`, packet);
    } catch (err) {
      log.warn('nlm-queue', `Obsidian mirror failed (packet saved locally): ${err.message}`);
    }

    await this.board.publish('knowledge:notebooklm:prepared', {
      author: 'nlm-queue',
      projectId,
      taskId,
      packetPath,
      queueType: queueType || 'promotion-source',
    });
    log.info('nlm-queue', `prepared: ${packetFilename}`);

    // Step 3: Mark as ingested
    // Actual browser-based NLM ingestion is external (add_source.py or NotebookLM MCP).
    // We publish ingested to complete the event loop and update dashboard.
    await this.board.publish('knowledge:notebooklm:ingested', {
      author: 'nlm-queue',
      projectId,
      taskId,
      registryPath: packetPath,
      queueType: queueType || 'promotion-source',
      sourceTitle: sourceTitle || taskId,
    });

    // Update queue status in Blackboard
    if (this.board.setConfig) {
      const queueKey = `knowledge:notebooklm:${projectId}:${taskId}:queued`;
      await this.board.setConfig(queueKey, {
        ...data,
        status: 'ingested',
        packetPath,
        processedAt: new Date().toISOString(),
      });
    }

    this.processed++;
    log.info('nlm-queue', `ingested: ${sourceTitle || taskId} (total: ${this.processed})`);
  }

  async _readSource(sourcePath) {
    if (!sourcePath) throw new Error('no sourcePath');

    // Try local filesystem first
    try {
      return await fsp.readFile(sourcePath, 'utf-8');
    } catch {
      // Fallback: try Obsidian REST API
      const vaultPath = sourcePath.replace(/^.*\/vault\//, '');
      return await this._obsidianGet(vaultPath);
    }
  }

  _renderPacket({ sourceTitle, sourcePath, projectId, taskId, content, queueType }) {
    const timestamp = new Date().toISOString();
    return `---
source: kingdom-nlm-queue
type: notebooklm-packet
project: "${projectId || 'unknown'}"
task_id: "${taskId || ''}"
source_title: "${sourceTitle || ''}"
source_path: "${sourcePath || ''}"
queue_type: "${queueType || 'promotion-source'}"
prepared_at: "${timestamp}"
tags: ["notebooklm", "auto-ingestion", "knowledge-pipeline"]
---

# NotebookLM Source: ${sourceTitle || 'Unknown'}

## Metadata
- **Project**: ${projectId || 'unknown'}
- **Task**: ${taskId || 'N/A'}
- **Source**: ${sourcePath || 'N/A'}
- **Prepared**: ${timestamp}

## Content

${content}

---
*Auto-prepared by Kingdom NotebookLM Queue Manager*
`;
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

  async _obsidianGet(filepath) {
    const url = `${this.obsidianBase}/vault/${encodeURIComponent(filepath)}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.obsidianToken}`,
        Accept: 'text/markdown',
      },
    });
    if (!res.ok) {
      throw new Error(`Obsidian GET ${filepath}: ${res.status}`);
    }
    return await res.text();
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

  getStats() {
    return { enabled: this.enabled, processed: this.processed };
  }

  async shutdown() {
    if (this.subscriber && this.subscriber.disconnect) {
      await this.subscriber.disconnect();
    }
    if (this.board && this.board.disconnect && this.board.client && this.board.client.isOpen) {
      await this.board.disconnect();
    }
    log.info('nlm-queue', 'shutdown complete');
  }
}

module.exports = { NotebookLMQueue };
