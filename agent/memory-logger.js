/**
 * Octiv Memory Logger — AC-7: Persistent disk logging for agent events
 * Writes JSONL files per agent for post-mortem analysis and cross-session learning.
 */
const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', 'logs');

class MemoryLogger {
  constructor(logDir = LOG_DIR) {
    this.logDir = logDir;
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  logEvent(agentId, event) {
    const entry = JSON.stringify({ ts: Date.now(), agentId, ...event }) + '\n';
    const filePath = path.join(this.logDir, `${agentId}.jsonl`);
    fs.appendFileSync(filePath, entry);
  }

  getHistory(agentId) {
    const filePath = path.join(this.logDir, `${agentId}.jsonl`);
    if (!fs.existsSync(filePath)) return [];
    return fs.readFileSync(filePath, 'utf-8')
      .trim().split('\n').filter(Boolean)
      .map(line => JSON.parse(line));
  }

  getByType(agentId, type) {
    return this.getHistory(agentId).filter(e => e.type === type);
  }

  clear(agentId) {
    const filePath = path.join(this.logDir, `${agentId}.jsonl`);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
}

module.exports = { MemoryLogger };
