/**
 * API Client Factory — creates LLM client wrappers for ReflexionEngine
 * Primary: Anthropic (Claude), Fallback: LM Studio local models, then Groq
 *
 * Clients implement: { call(model, prompt) → Promise<string> }
 * Gracefully degrades when SDK/API key is unavailable.
 */
const { getLogger } = require('./logger');
const T = require('../../config/timeouts');
const log = getLogger();

function createApiClients() {
  const LM_STUDIO_BASE_URL = process.env.LM_STUDIO_URL || 'http://localhost:1234';
  const clients = {};

  // Anthropic client (primary)
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const Anthropic = require('@anthropic-ai/sdk');
      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      clients.anthropic = {
        call: async (model, prompt) => {
          const response = await anthropic.messages.create({
            model,
            max_tokens: T.LLM_MAX_TOKENS,
            messages: [{ role: 'user', content: prompt }],
          });
          return response.content[0]?.text || '';
        },
      };
      log.info('api-clients', 'Anthropic client ready');
    } catch (err) {
      log.warn('api-clients', 'Anthropic SDK load failed', { error: err.message });
    }
  } else {
    log.warn('api-clients', 'ANTHROPIC_API_KEY not set — LLM generation disabled');
  }

  // LM Studio client (local fallback — OpenAI-compatible API)
  if (process.env.LM_STUDIO_ENABLED === 'false') {
    log.info('api-clients', 'LM Studio disabled via LM_STUDIO_ENABLED=false');
  } else {
    clients.local = {
      call: async (model, prompt) => {
        // 2s pre-check: fail fast if LM Studio is not running
        const check = await fetch(`${LM_STUDIO_BASE_URL}/v1/models`, {
          signal: AbortSignal.timeout(T.LM_STUDIO_PRECHECK_TIMEOUT_MS),
        }).catch(() => null);
        if (!check?.ok) throw new Error('LM Studio not reachable');

        const url = `${LM_STUDIO_BASE_URL}/v1/chat/completions`;
        const messages = [{ role: 'user', content: prompt }];
        // Qwen3 models support /no_think to skip reasoning for faster responses
        if (model.startsWith('qwen')) {
          messages.unshift({ role: 'system', content: '/no_think' });
        }
        const body = JSON.stringify({
          model,
          messages,
          max_tokens: T.LLM_MAX_TOKENS,
          temperature: 0.7,
        });
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          signal: AbortSignal.timeout(T.LM_STUDIO_REQUEST_TIMEOUT_MS),
        });
        if (!res.ok) throw new Error(`LM Studio ${res.status}: ${await res.text()}`);
        const data = await res.json();
        return data.choices?.[0]?.message?.content || '';
      },
    };
    log.info('api-clients', `LM Studio client ready (${LM_STUDIO_BASE_URL})`);
  }

  // Groq client (optional cloud fallback)
  if (process.env.GROQ_API_KEY) {
    try {
      const Groq = require('groq-sdk');
      const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
      clients.groq = {
        call: async (model, prompt) => {
          const response = await groq.chat.completions.create({
            model,
            messages: [{ role: 'user', content: prompt }],
          });
          return response.choices[0]?.message?.content || '';
        },
      };
      log.info('api-clients', 'Groq client ready');
    } catch {
      // Groq is optional — silently skip
    }
  }

  return clients;
}

module.exports = { createApiClients };
