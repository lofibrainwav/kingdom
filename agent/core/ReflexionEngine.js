/**
 * Kingdom ReflexionEngine — Phase 4.3 + 4.5 + 4.6
 * LLM bridge with multi-model routing, cost guardrails, config auto-reload.
 * Primary: LM Studio (local) → fallback Anthropic/Groq if available.
 * Override model via: LLM_PRIMARY_MODEL env var
 */
const { Blackboard } = require('./blackboard');
const { getLogger } = require('./logger');
const T = require('../../config/timeouts');
const log = getLogger();

function _getPrimaryModel() {
  return process.env.LLM_PRIMARY_MODEL || 'local:qwen/qwen3-8b';
}

function _getDefaultConfig() {
  const model = _getPrimaryModel();
  return {
    model,
    escalationModel: model,     // LM Studio handles all tiers locally
    fallbackModel: 'groq:llama-3.3-70b-versatile', // cloud fallback if LM Studio down
    temperature: 0.7,
    maxTokens: T.LLM_MAX_TOKENS,
    costPerAttempt: 0.00,   // local = free
    maxCostPerDay: 0.00,    // no cost limit for local
  };
}

class ReflexionEngine {
  constructor(apiClients, options = {}) {
    this.board = options.board || new Blackboard();
    this.config = _getDefaultConfig();
    // Auto-create API clients if none injected
    this.apiClients = apiClients || require('./api-clients').createApiClients();
    this.dailyCost = 0;
    this.totalCalls = 0;
    this.modelUsage = {};
  }

  async init() {
    await this.board.connect();
    // Load config from Redis
    await this.reloadConfig();
    log.info('reflexion', `initialized, model: ${this.config.model}`);
  }

  // 4.5: Reload config from Redis (hot reload)
  async reloadConfig() {
    const saved = await this.board.getConfig('config:llm');
    if (saved) {
      Object.assign(this.config, saved);
    }
    return this.config;
  }

  // 4.5: Save config to Redis
  async saveConfig(updates) {
    Object.assign(this.config, updates);
    await this.board.setConfig('config:llm', this.config);
    await this.board.publish('config:llm:updated', { author: 'reflexion-engine', ...this.config });
    return this.config;
  }

  // 4.5: Generate skill JSON from failure context
  async generateSkill(failureContext) {
    const prompt = this._buildPrompt(failureContext);
    const response = await this.callLLM(prompt, failureContext.severity || 'normal');

    if (!response) return null;
    return parseLLMJson(response);
  }

  // 4.6: Multi-LLM router with escalation and fallback
  async callLLM(prompt, severity = 'normal') {
    // Cost guardrail (0 = unlimited, for local/free models)
    if (this.config.maxCostPerDay > 0 && this.dailyCost >= this.config.maxCostPerDay) {
      log.warn('reflexion', 'daily cost limit reached');
      return null;
    }

    const model = severity === 'critical'
      ? this.config.escalationModel
      : this.config.model;

    this.totalCalls++;
    this.dailyCost += this.config.costPerAttempt;

    // Try primary model
    try {
      const result = await this._callModel(model, prompt);
      this._trackUsage(model);
      return result;
    } catch (primaryErr) {
      log.warn('reflexion', `primary (${model}) failed`, { error: primaryErr.message });
    }

    // Fallback to Groq
    try {
      const result = await this._callModel(this.config.fallbackModel, prompt);
      this._trackUsage(this.config.fallbackModel);
      return result;
    } catch (fallbackErr) {
      log.error('reflexion', 'fallback failed', { error: fallbackErr.message });
    }

    return null;
  }

  async _callModel(model, prompt) {
    if (model.startsWith('local:') && this.apiClients.local) {
      return await this.apiClients.local.call(model.slice(6), prompt);
    }
    if (model.startsWith('groq:') && this.apiClients.groq) {
      return await this.apiClients.groq.call(model.slice(5), prompt);
    }
    if (this.apiClients.anthropic) {
      return await this.apiClients.anthropic.call(model, prompt);
    }
    throw new Error(`No API client for model: ${model}`);
  }

  _buildPrompt(context) {
    return [
      'Generate a Vibe Coding skill to handle this task or failure.',
      `Error/Context: ${context.error || context.message}`,
      `Type: ${context.errorType || context.type || 'unknown'}`,
      `Agent: ${context.agentId || 'unknown'}`,
      'Return a JSON object with: { name, code, description, errorType }',
      'The code must be safe, synchronous JavaScript for the agent workflow.',
    ].join('\n');
  }

  _trackUsage(model) {
    this.modelUsage[model] = (this.modelUsage[model] || 0) + 1;
  }

  getStats() {
    return {
      totalCalls: this.totalCalls,
      dailyCost: this.dailyCost,
      modelUsage: { ...this.modelUsage },
      config: { ...this.config },
    };
  }

  async shutdown() {
    await this.board.disconnect();
  }
}

/** Extract JSON object from LLM response (raw string or pre-parsed object) */
function parseLLMJson(response) {
  if (typeof response === 'object' && response !== null) return response;
  try {
    // Strip <think>...</think> blocks from reasoning models (e.g., glm-4.6v-flash)
    let text = String(response).replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
  } catch {}
  return null;
}

module.exports = { ReflexionEngine, _getDefaultConfig, parseLLMJson };
