/**
 * API Client Factory — creates LLM client wrappers for ReflexionEngine
 * Primary: Anthropic (Claude), Fallback: Groq (optional)
 *
 * Clients implement: { call(model, prompt) → Promise<string> }
 * Gracefully degrades when SDK/API key is unavailable.
 */

function createApiClients() {
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
            max_tokens: 1024,
            messages: [{ role: 'user', content: prompt }],
          });
          return response.content[0]?.text || '';
        },
      };
      console.log('[ApiClients] Anthropic client ready');
    } catch (err) {
      console.warn('[ApiClients] Anthropic SDK load failed:', err.message);
    }
  } else {
    console.warn('[ApiClients] ANTHROPIC_API_KEY not set — LLM generation disabled');
  }

  // Groq client (optional fallback)
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
      console.log('[ApiClients] Groq client ready');
    } catch {
      // Groq is optional — silently skip
    }
  }

  return clients;
}

module.exports = { createApiClients };
