/**
 * Shared mock Blackboard factory for unit tests.
 * Provides all public methods from agent/core/blackboard.js as functional stubs
 * backed by in-memory Maps. Ensures mock fidelity with the real Blackboard API.
 *
 * Usage:
 *   const { createMockBoard } = require('./helpers/mock-board');
 *   const { board, published, configs, hashes, subscriptions } = createMockBoard();
 */

function createMockBoard() {
  const configs = new Map();
  const hashes = new Map();
  const skills = new Map();
  const published = [];
  const subscriptions = new Map();
  const acProgress = new Map();
  const reflexionLogs = new Map();
  const lists = new Map();
  const statuses = [];

  const board = {
    client: { isOpen: true },

    // Connection lifecycle
    connect: async () => {},
    disconnect: async () => {},

    // Publish / Subscribe
    publish: async (channel, data) => {
      published.push({ channel, data });
      const handlers = subscriptions.get(channel) || [];
      for (const handler of handlers) {
        await handler(data);
      }
    },

    get: async (channel) => {
      const entry = [...published].reverse().find((e) => e.channel === channel);
      return entry ? entry.data : null;
    },

    batchPublish: async (entries) => {
      for (const entry of entries) {
        await board.publish(entry.channel, entry.data);
      }
      return { count: entries.length };
    },

    batchGet: async (channels) => {
      const results = {};
      for (const ch of channels) {
        results[ch] = await board.get(ch);
      }
      return results;
    },

    createSubscriber: async () => ({
      on: () => {},
      subscribe: async (channel, handler) => {
        const handlers = subscriptions.get(channel) || [];
        handlers.push(handler);
        subscriptions.set(channel, handlers);
      },
      unsubscribe: async (channel) => {
        if (!channel) {
          subscriptions.clear();
          return;
        }
        subscriptions.delete(channel);
      },
      pSubscribe: async () => {},
      pUnsubscribe: async () => {},
      disconnect: async () => {},
      quit: async () => {},
      get isReady() { return true; },
    }),

    // Config
    setConfig: async (key, value) => {
      configs.set(key, value);
    },

    getConfig: async (key) => configs.get(key) || null,

    listConfigs: async (prefix = '') => {
      const results = [];
      for (const [key, value] of configs) {
        if (key.startsWith(prefix)) {
          results.push({ key, value });
        }
      }
      return results;
    },

    // Hash
    setHashField: async (key, field, data) => {
      if (!hashes.has(key)) hashes.set(key, new Map());
      hashes.get(key).set(field, data);
    },

    getHashField: async (key, field) => {
      const hash = hashes.get(key);
      return hash ? (hash.get(field) || null) : null;
    },

    getHash: async (key) => {
      const hash = hashes.get(key);
      if (!hash) return {};
      const result = {};
      for (const [k, v] of hash) result[k] = v;
      return result;
    },

    deleteHashField: async (key, field) => {
      const hash = hashes.get(key);
      if (hash) hash.delete(field);
    },

    // Agent status
    updateStatus: async (agentId, statusObj) => {
      statuses.push({ agentId, status: statusObj });
      await board.setHashField('agents:status', agentId, statusObj);
    },

    getAllStatuses: async () => {
      return board.getHash('agents:status');
    },

    // Skills
    saveSkill: async (name, skillData) => {
      skills.set(name, skillData);
    },

    getSkill: async (name) => skills.get(name) || null,

    atomicUpdateSkill: async (name, updateFn) => {
      const current = skills.get(name) || null;
      const updated = updateFn(current);
      if (updated !== undefined && updated !== null) {
        skills.set(name, updated);
      }
      return updated || null;
    },

    // AC Progress
    updateAC: async (agentId, acNum, status) => {
      const key = `${agentId}:ac`;
      if (!acProgress.has(key)) acProgress.set(key, {});
      acProgress.get(key)[`ac${acNum}`] = status;
    },

    getACProgress: async (agentId) => {
      return acProgress.get(`${agentId}:ac`) || {};
    },

    batchUpdateAC: async (updates) => {
      for (const { agentId, acNum, status } of updates) {
        await board.updateAC(agentId, acNum, status);
      }
    },

    // Reflexion
    logReflexion: async (agentId, entry) => {
      const key = `agent:${agentId}:reflexion`;
      if (!reflexionLogs.has(key)) reflexionLogs.set(key, []);
      const logs = reflexionLogs.get(key);
      logs.unshift(JSON.stringify(entry));
      if (logs.length > 50) logs.length = 50;
    },

    // Lists
    getListRange: async (key, start = 0, stop = -1) => {
      const list = lists.get(key) || [];
      const end = stop === -1 ? list.length : stop + 1;
      return list.slice(start, end).map((item) =>
        typeof item === 'string' ? item : JSON.stringify(item)
      );
    },
  };

  return { board, published, configs, hashes, skills, subscriptions, statuses, acProgress, reflexionLogs, lists };
}

module.exports = { createMockBoard };
