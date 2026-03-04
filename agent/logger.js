/**
 * Octiv Structured Logger — unified logging across all agents
 *
 * Wraps MemoryLogger for JSONL persistence while providing
 * leveled console output with consistent formatting.
 *
 * API:
 *   logger.info(agentId, msg, data?)
 *   logger.warn(agentId, msg, data?)
 *   logger.error(agentId, msg, data?)
 *   logger.debug(agentId, msg, data?)
 */

const { MemoryLogger } = require('./memory-logger');

const LEVELS = {
  debug: { rank: 0, label: 'DEBUG', consoleFn: 'log' },
  info:  { rank: 1, label: 'INFO',  consoleFn: 'log' },
  warn:  { rank: 2, label: 'WARN',  consoleFn: 'warn' },
  error: { rank: 3, label: 'ERROR', consoleFn: 'error' },
};

class Logger {
  /**
   * @param {object} [options]
   * @param {string} [options.minLevel='info'] - Minimum log level ('debug'|'info'|'warn'|'error')
   * @param {boolean} [options.console=true] - Enable console output
   * @param {boolean} [options.persist=true] - Enable JSONL persistence via MemoryLogger
   * @param {MemoryLogger} [options.memoryLogger] - Custom MemoryLogger instance
   * @param {string} [options.logDir] - Custom log directory (passed to MemoryLogger)
   */
  constructor(options = {}) {
    const minLevel = options.minLevel || process.env.LOG_LEVEL || 'info';
    this.minRank = (LEVELS[minLevel] || LEVELS.info).rank;
    this.consoleEnabled = options.console !== false;
    this.persistEnabled = options.persist !== false;

    if (this.persistEnabled) {
      this.memoryLogger = options.memoryLogger || new MemoryLogger(options.logDir);
    } else {
      this.memoryLogger = null;
    }
  }

  /**
   * Core log method
   * @param {string} level - Log level
   * @param {string} agentId - Agent identifier
   * @param {string} msg - Log message
   * @param {object} [data] - Additional structured data
   */
  _log(level, agentId, msg, data) {
    const levelDef = LEVELS[level];
    if (!levelDef || levelDef.rank < this.minRank) return;

    // Console output
    if (this.consoleEnabled) {
      const prefix = `[${levelDef.label}] [${agentId}]`;
      if (data && Object.keys(data).length > 0) {
        console[levelDef.consoleFn](`${prefix} ${msg}`, data);
      } else {
        console[levelDef.consoleFn](`${prefix} ${msg}`);
      }
    }

    // JSONL persistence (fire-and-forget)
    if (this.persistEnabled && this.memoryLogger) {
      this.memoryLogger.logEvent(agentId, {
        type: 'log',
        level,
        message: msg,
        ...data,
      }).catch((err) => {
        // Avoid recursive logging — just stderr
        process.stderr.write(`[Logger] persist error: ${err.message}\n`);
      });
    }
  }

  debug(agentId, msg, data) { this._log('debug', agentId, msg, data); }
  info(agentId, msg, data)  { this._log('info', agentId, msg, data); }
  warn(agentId, msg, data)  { this._log('warn', agentId, msg, data); }
  error(agentId, msg, data) { this._log('error', agentId, msg, data); }
}

// Singleton for shared use
let _defaultInstance;
function getLogger(options) {
  if (!_defaultInstance) {
    _defaultInstance = new Logger(options);
  }
  return _defaultInstance;
}

module.exports = { Logger, getLogger };
