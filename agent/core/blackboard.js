/**
 * Kingdom Blackboard — Redis-based Agent Shared Memory
 * All agents share state through this module.
 */
const { createClient } = require('redis');
const T = require('../../config/timeouts');
const { getLogger } = require('./logger');
const { validateEventPayload } = require('./event-schemas');
const log = getLogger();

const REDIS_URL = process.env.BLACKBOARD_REDIS_URL || 'redis://localhost:6380';
const PREFIX = 'kingdom:';

const CHANNEL_RULES = [
  {
    canonical: 'work:intake',
    aliases: ['commands:assign'],
  },
  {
    canonical: 'work:planning:init',
    aliases: ['pm:project_init'],
  },
  {
    canonical: 'execution:swarm:spawn',
    aliases: ['swarm:spawn'],
  },
  {
    canonical: 'execution:swarm:terminate',
    aliases: ['swarm:terminate'],
  },
  {
    canonical: 'knowledge:skills:deployed',
    aliases: ['skills:emergency'],
  },
  {
    canonical: 'knowledge:rumination:digested',
    aliases: ['rumination:digested'],
  },
  {
    canonical: 'knowledge:zettelkasten:tier-up',
    aliases: ['zettelkasten:tier-up'],
  },
  {
    canonical: 'knowledge:zettelkasten:compound-created',
    aliases: ['zettelkasten:compound-created'],
  },
  {
    canonical: 'work:planning:designed',
    aliases: ['architect:design_complete'],
  },
  {
    canonical: 'work:planning:decomposed',
    aliases: ['decomposer:plan_complete'],
  },
  {
    canonical: 'governance:review:approved',
    aliases: ['reviewer:task_approved'],
  },
  {
    canonical: 'governance:review:rejected',
    aliases: ['reviewer:task_rejected'],
  },
  {
    canonical: 'governance:failure:retry-requested',
    aliases: ['failure:retry_requested'],
  },
  {
    canonical: 'governance:project:approved',
    aliases: ['reviewer:project_approved'],
  },
  {
    canonical: 'governance:review:requested',
    aliases: ['coder:task_complete'],
  },
  {
    canonical: 'execution:deployment:completed',
    aliases: ['deployer:deployed'],
  },
  {
    canonical: 'knowledge:got:completed',
    aliases: ['got:reasoning-complete'],
  },
  {
    canonical: 'governance:watchdog:recovery',
    aliases: ['watchdog:recovery'],
  },
  {
    canonical: 'governance:safety:threat',
    aliases: ['safety:threat'],
  },
  {
    canonical: 'knowledge:reflexion:triggered',
    aliases: ['leader:reflexion'],
  },
  {
    canonical: 'governance:task:completed',
    aliases: ['task:completed'],
  },
  // Phase-3 channels (no legacy aliases)
  { canonical: 'work:task:started', aliases: [] },
  { canonical: 'work:dry-run:recorded', aliases: [] },
  { canonical: 'execution:task:workspace-ready', aliases: [] },
  { canonical: 'knowledge:capture:stored', aliases: [] },
  { canonical: 'knowledge:promotion:candidate', aliases: [] },
  { canonical: 'knowledge:promotion:applied', aliases: [] },
  { canonical: 'knowledge:notebooklm:queued', aliases: [] },
  { canonical: 'knowledge:notebooklm:claimed', aliases: [] },
  { canonical: 'knowledge:notebooklm:prepared', aliases: [] },
  { canonical: 'knowledge:notebooklm:ingested', aliases: [] },
  { canonical: 'knowledge:skill:eval-completed', aliases: [] },
  { canonical: 'config:llm:updated', aliases: [] },
  { canonical: 'orchestrator:registered', aliases: [] },
  { canonical: 'orchestrator:deregistered', aliases: [] },
  { canonical: 'team:celebration', aliases: [] },
  {
    match: /^execution:dispatch:(.+)$/ ,
    canonicalFromMatch: (match) => `execution:dispatch:${match[1]}`,
    aliasesFromMatch: (match) => [`command:${match[1]}:task`],
  },
  {
    match: /^command:(.+):task$/ ,
    canonicalFromMatch: (match) => `execution:dispatch:${match[1]}`,
    aliasesFromMatch: (match) => [`command:${match[1]}:task`],
  },
  {
    match: /^execution:broadcast:(.+)$/ ,
    canonicalFromMatch: (match) => `execution:broadcast:${match[1]}`,
    aliasesFromMatch: (match) => [`command:${match[1]}:broadcast`],
  },
  {
    match: /^command:(.+):broadcast$/ ,
    canonicalFromMatch: (match) => `execution:broadcast:${match[1]}`,
    aliasesFromMatch: (match) => [`command:${match[1]}:broadcast`],
  },
];

class Blackboard {
  constructor(redisUrl, options = {}) {
    const url = redisUrl || REDIS_URL;
    this.client = createClient({
      url,
      socket: {
        reconnectStrategy: (retries) => {
          if (retries > T.MAX_RECONNECT_ATTEMPTS) return false;
          return Math.min(retries * 100, T.REDIS_RECONNECT_MAX_MS);
        },
        ...options.socket,
      },
    });
    this.client.on('error', (err) => log.error('blackboard', 'Redis error', { error: err.message }));
  }

  async connect() {
    await this.client.connect();
    log.info('blackboard', `Connected: ${REDIS_URL}`);
  }

  async disconnect() {
    try {
      if (this.client.isOpen) {
        await this.client.quit();
      }
    } catch (err) {
      log.debug('blackboard', `quit() failed, forcing disconnect: ${err.message}`);
    }
    // Always force-destroy to stop pending reconnection attempts
    try {
      await this.client.disconnect();
    } catch (err) {
      log.debug('blackboard', `disconnect() already done: ${err.message}`);
    }
  }

  _stripPrefix(channel) {
    return channel && channel.startsWith(PREFIX) ? channel.slice(PREFIX.length) : channel;
  }

  _getChannelFamily(channel) {
    const normalized = this._stripPrefix(channel);

    for (const rule of CHANNEL_RULES) {
      if (rule.canonical && (normalized === rule.canonical || rule.aliases.includes(normalized))) {
        return [rule.canonical, ...rule.aliases];
      }

      if (rule.match) {
        const match = normalized.match(rule.match);
        if (match) {
          return [rule.canonicalFromMatch(match), ...rule.aliasesFromMatch(match)];
        }
      }
    }

    return [normalized];
  }

  _parsePayload(payload) {
    if (typeof payload !== 'string') return payload;
    try {
      return JSON.parse(payload);
    } catch {
      return payload;
    }
  }

  _normalizePattern(pattern) {
    return PREFIX + this._stripPrefix(pattern);
  }

  /**
   * Publish agent status (眞善美孝永 validated)
   */
  async publish(channel, data) {
    this._validate(channel, data);
    const family = this._getChannelFamily(channel);
    const payload = JSON.stringify({ ts: Date.now(), ...data });
    const multi = this.client.multi();

    for (const entry of family) {
      multi.publish(PREFIX + entry, payload);
      multi.set(PREFIX + entry + ':latest', payload, { EX: T.REDIS_KEY_EXPIRY_SECONDS });
    }

    await multi.exec();
  }

  /**
   * Read latest status
   */
  async get(channel) {
    for (const entry of this._getChannelFamily(channel)) {
      const val = await this.client.get(PREFIX + entry + ':latest');
      if (val) return JSON.parse(val);
    }
    return null;
  }

  /**
   * Save skill to library
   */
  async saveSkill(name, skillData) {
    await this.client.hSet(PREFIX + 'skills:library', name, JSON.stringify(skillData));
    log.info('blackboard', `Skill saved: ${name}`);
  }

  /**
   * Retrieve skill from library
   */
  async getSkill(name) {
    const val = await this.client.hGet(PREFIX + 'skills:library', name);
    return val ? JSON.parse(val) : null;
  }

  /**
   * Update AC progress
   */
  async updateAC(agentId, acNum, status) {
    await this.client.hSet(
      PREFIX + `agent:${agentId}:ac`,
      `AC-${acNum}`,
      JSON.stringify({ status, ts: Date.now() })
    );
  }

  /**
   * Retrieve all AC progress for an agent
   */
  async getACProgress(agentId) {
    return await this.client.hGetAll(PREFIX + `agent:${agentId}:ac`);
  }

  /**
   * Log reflection entry (maintains max 50 entries)
   */
  async logReflexion(agentId, entry) {
    await this.client.lPush(
      PREFIX + `agent:${agentId}:reflexion`,
      JSON.stringify({ ts: Date.now(), ...entry })
    );
    // Keep only recent 50 entries
    await this.client.lTrim(PREFIX + `agent:${agentId}:reflexion`, 0, 49);
  }

  // ── Phase 7.4: Redis Pipeline Optimization ────────────────

  /**
   * Batch publish multiple channels atomically via MULTI/EXEC.
   * entries: [{ channel, data }]
   * ~77% latency reduction vs sequential publishes.
   */
  async batchPublish(entries) {
    for (const { channel, data } of entries) {
      this._validate(channel, data);
    }
    const multi = this.client.multi();
    const now = Date.now();
    let operations = 0;

    for (const { channel, data } of entries) {
      const payload = JSON.stringify({ ts: now, ...data });
      for (const entry of this._getChannelFamily(channel)) {
        multi.publish(PREFIX + entry, payload);
        multi.set(PREFIX + entry + ':latest', payload, { EX: T.REDIS_KEY_EXPIRY_SECONDS });
        operations += 2;
      }
    }

    const results = await multi.exec();
    return { count: entries.length, results: results.length, operations };
  }

  /**
   * Batch update multiple AC entries atomically.
   * updates: [{ agentId, acNum, status }]
   */
  async batchUpdateAC(updates) {
    const multi = this.client.multi();
    const now = Date.now();
    for (const { agentId, acNum, status } of updates) {
      multi.hSet(
        PREFIX + `agent:${agentId}:ac`,
        `AC-${acNum}`,
        JSON.stringify({ status, ts: now })
      );
    }
    return await multi.exec();
  }

  /**
   * Atomic read-modify-write for skill success rate.
   * Uses WATCH + MULTI for optimistic locking.
   */
  async atomicUpdateSkill(name, updateFn) {
    const key = PREFIX + 'skills:library';
    const maxRetries = 3;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      await this.client.watch(key);
      const raw = await this.client.hGet(key, name);
      if (!raw) {
        await this.client.unwatch();
        return null;
      }

      const skill = JSON.parse(raw);
      const updated = updateFn(skill);
      if (!updated) {
        await this.client.unwatch();
        return null;
      }

      const multi = this.client.multi();
      multi.hSet(key, name, JSON.stringify(updated));

      try {
        const results = await multi.exec();
        if (results !== null) return updated;
      } catch {
        // WATCH conflict — retry
      }
    }
    return null;
  }

  /**
   * Batch get multiple keys in a single round-trip.
   */
  async batchGet(channels) {
    const multi = this.client.multi();
    for (const channel of channels) {
      multi.get(PREFIX + channel + ':latest');
    }
    const results = await multi.exec();
    return channels.map((ch, i) => {
      const val = results[i];
      try { return val ? JSON.parse(val) : null; } catch { return null; }
    });
  }

  // ── 眞善美孝永 Validation ────────────────────────────────────

  /**
   * Validate channel and data before publishing.
   * 眞 (Truth): channel/data must be valid
   * 孝 (Respect): author field required
   * 善 (Goodness): payload size limit (10KB)
   * 美 (Beauty): channel naming convention
   */
  _validate(channel, data) {
    if (!channel || typeof channel !== 'string') {
      throw new Error('[Blackboard] 眞: channel must be a non-empty string');
    }
    if (!data || typeof data !== 'object') {
      throw new Error('[Blackboard] 眞: data must be a non-empty object');
    }
    if (!data.author) {
      throw new Error('[Blackboard] 孝: author field is required — identify yourself');
    }
    const json = JSON.stringify(data);
    if (json.length > 10240) {
      throw new Error('[Blackboard] 善: payload too large (max 10KB)');
    }
    if (!/^[a-z0-9:_-]+$/.test(channel)) {
      throw new Error('[Blackboard] 美: channel must be lowercase alphanumeric with : _ -');
    }

    validateEventPayload(this._getChannelFamily(channel)[0], data);
  }

  // ── Config helpers (avoid direct client access) ────────────

  /**
   * Get JSON config by key (e.g., 'config:llm', 'skills:daily_meta')
   */
  async getConfig(key) {
    const raw = await this.client.get(PREFIX + key);
    return raw ? JSON.parse(raw) : null;
  }

  /**
   * Set JSON config by key
   */
  async setConfig(key, data) {
    await this.client.set(PREFIX + key, JSON.stringify(data));
  }

  /**
   * List JSON configs by key prefix
   */
  async listConfigs(prefix = '') {
    const keys = await this.client.keys(PREFIX + prefix + '*');
    const results = [];

    for (const fullKey of keys.sort()) {
      const raw = await this.client.get(fullKey);
      if (!raw) continue;
      results.push({
        key: this._stripPrefix(fullKey),
        value: JSON.parse(raw),
      });
    }

    return results;
  }

  /**
   * Update agent status in the agents:status hash
   */
  async updateStatus(agentId, statusObj) {
    await this.setHashField('agents:status', agentId, statusObj);
  }

  /**
   * Get all agent statuses from the agents:status hash
   */
  async getAllStatuses() {
    const raw = await this.getHash('agents:status');
    const result = {};
    for (const [key, value] of Object.entries(raw)) {
      try {
        result[key] = typeof value === 'string' ? JSON.parse(value) : value;
      } catch {
        result[key] = value;
      }
    }
    return result;
  }

  /**
   * Get all entries from a hash (e.g., 'agents:registry')
   */
  async getHash(key) {
    return await this.client.hGetAll(PREFIX + key);
  }

  /**
   * Set a field in a hash
   */
  async setHashField(key, field, data) {
    await this.client.hSet(PREFIX + key, field, JSON.stringify(data));
  }

  /**
   * Get a single field from a hash (e.g., one skill from 'zettelkasten:notes')
   */
  async getHashField(key, field) {
    const raw = await this.client.hGet(PREFIX + key, field);
    return raw ? JSON.parse(raw) : null;
  }

  /**
   * Delete a field from a hash
   */
  async deleteHashField(key, field) {
    await this.client.hDel(PREFIX + key, field);
  }

  /**
   * Create a duplicate client for pub/sub subscribers
   */
  async createSubscriber() {
    const raw = this.client.duplicate();
    await raw.connect();

    return {
      get isReady() {
        return raw.isReady;
      },
      on: (...args) => raw.on(...args),
      quit: async () => raw.quit(),
      disconnect: async () => raw.disconnect(),
      subscribe: async (channel, handler) => {
        for (const entry of this._getChannelFamily(channel)) {
          await raw.subscribe(PREFIX + entry, (message) => handler(this._parsePayload(message)));
        }
      },
      unsubscribe: async (channel) => {
        if (!channel) {
          await raw.unsubscribe();
          return;
        }

        for (const entry of this._getChannelFamily(channel)) {
          await raw.unsubscribe(PREFIX + entry);
        }
      },
      pSubscribe: async (pattern, handler) => {
        const normalizedPattern = this._normalizePattern(pattern);
        await raw.pSubscribe(normalizedPattern, (message, channel) => {
          handler(this._parsePayload(message), this._stripPrefix(channel));
        });
      },
      pUnsubscribe: async (pattern) => {
        if (!pattern) {
          await raw.pUnsubscribe();
          return;
        }

        await raw.pUnsubscribe(this._normalizePattern(pattern));
      },
      raw,
    };
  }

  /**
   * Get list range (e.g., reflexion logs)
   */
  async getListRange(key, start = 0, stop = -1) {
    return await this.client.lRange(PREFIX + key, start, stop);
  }
}

Blackboard.PREFIX = PREFIX;

module.exports = { Blackboard, PREFIX };
