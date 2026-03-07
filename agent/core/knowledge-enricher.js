/**
 * KnowledgeEnricher — Inject accumulated knowledge into LLM prompts.
 *
 * Ralph Team's qwen3-8b is persistent, not brilliant.
 * But with the right context, persistence becomes power:
 *   - Zettelkasten skills (XP, success rates, compound synergies)
 *   - Vault patterns (debugging lessons, architecture decisions)
 *   - Cached research (Grok search + NLM query results)
 *
 * Philosophy: 끈기 > 똑똑함. One good context injection
 * beats ten clever prompting tricks.
 */
const fsp = require('fs').promises;
const path = require('path');
const { getLogger } = require('./logger');
const log = getLogger();

const VAULT_SKILLS = path.join(__dirname, '..', 'vault', '04-Skills');
const VAULT_RESEARCH = path.join(__dirname, '..', 'vault', '02-Research');

class KnowledgeEnricher {
  constructor(options = {}) {
    this.zk = options.zk || null;  // SkillZettelkasten instance
    this.board = options.board || null;
    this.maxContextChars = options.maxContextChars || 2000;
    this._cache = { skills: null, skillsAt: 0, research: null, researchAt: 0 };
    this._cacheTTL = 60000; // 1 minute
  }

  /**
   * Enrich a prompt with relevant knowledge context.
   * Returns the original prompt with a [KNOWLEDGE CONTEXT] block prepended.
   */
  async enrich(prompt, hints = {}) {
    const sections = [];

    // 1. Zettelkasten — relevant skills for this errorType/domain
    const skillContext = await this._getSkillContext(hints.errorType, hints.skills);
    if (skillContext) sections.push(skillContext);

    // 2. Cached research — recent Grok/NLM findings
    const researchContext = await this._getResearchContext(hints.topic);
    if (researchContext) sections.push(researchContext);

    // 3. Rumination insights — recent digestion learnings
    const ruminationContext = await this._getRuminationContext(hints.errorType);
    if (ruminationContext) sections.push(ruminationContext);

    if (sections.length === 0) return prompt;

    const context = sections.join('\n\n');
    // Trim to budget
    const trimmed = context.length > this.maxContextChars
      ? context.slice(0, this.maxContextChars) + '...'
      : context;

    return `[KNOWLEDGE CONTEXT]\n${trimmed}\n[END CONTEXT]\n\n${prompt}`;
  }

  // ── Zettelkasten Skills ──────────────────────────────────

  async _getSkillContext(errorType, skillIds) {
    if (!this.zk) return null;

    try {
      const now = Date.now();
      if (!this._cache.skills || now - this._cache.skillsAt > this._cacheTTL) {
        this._cache.skills = await this.zk.getAllNotes();
        this._cache.skillsAt = now;
      }

      const allNotes = this._cache.skills;
      const notes = Object.values(allNotes);
      if (notes.length === 0) return null;

      // Filter relevant skills
      let relevant;
      if (errorType) {
        relevant = notes.filter(n =>
          n.status === 'active' && (n.errorType === errorType || n.errorType?.includes(errorType))
        );
      }
      if ((!relevant || relevant.length === 0) && skillIds?.length) {
        relevant = notes.filter(n => skillIds.includes(n.id));
      }
      if (!relevant || relevant.length === 0) {
        // Fallback: top 5 by XP
        relevant = notes
          .filter(n => n.status === 'active')
          .sort((a, b) => b.xp - a.xp)
          .slice(0, 5);
      }

      const lines = relevant.map(n => {
        const links = n.links?.length ? ` links:[${n.links.join(',')}]` : '';
        return `- ${n.id} (${n.tier}, XP:${n.xp}, rate:${(n.successRate * 100).toFixed(0)}%${links})`;
      });

      return `Skills (${relevant.length}):\n${lines.join('\n')}`;
    } catch (err) {
      log.warn('enricher', `skill context failed: ${err.message}`);
      return null;
    }
  }

  // ── Cached Research (Grok + NLM results) ─────────────────

  async _getResearchContext(topic) {
    try {
      const now = Date.now();
      if (!this._cache.research || now - this._cache.researchAt > this._cacheTTL) {
        this._cache.research = await this._loadLatestResearch();
        this._cache.researchAt = now;
      }

      if (!this._cache.research) return null;

      // If topic given, filter entries containing it
      if (topic) {
        const filtered = this._cache.research.filter(r =>
          r.toLowerCase().includes(topic.toLowerCase())
        );
        if (filtered.length > 0) return `Research:\n${filtered.slice(0, 3).join('\n')}`;
      }

      // Return most recent entries
      return `Research:\n${this._cache.research.slice(0, 3).join('\n')}`;
    } catch {
      return null;
    }
  }

  async _loadLatestResearch() {
    try {
      const files = await fsp.readdir(VAULT_RESEARCH);
      const weeklyFiles = files
        .filter(f => f.startsWith('weekly-') && f.endsWith('.md') && !f.includes('queue') && !f.includes('answers'))
        .sort()
        .reverse()
        .slice(0, 2);

      const entries = [];
      for (const f of weeklyFiles) {
        const content = await fsp.readFile(path.join(VAULT_RESEARCH, f), 'utf-8');
        // Extract Answer lines
        const answers = content.match(/\*\*Answer\*\*: .+/g);
        if (answers) {
          entries.push(...answers.map(a => a.replace('**Answer**: ', '').slice(0, 200)));
        }
      }
      return entries.length > 0 ? entries : null;
    } catch {
      return null;
    }
  }

  // ── Rumination Insights ──────────────────────────────────

  async _getRuminationContext(errorType) {
    if (!this.zk) return null;

    try {
      const notes = Object.values(this._cache.skills || await this.zk.getAllNotes());
      const withNotes = notes.filter(n =>
        n.ruminationNotes?.length > 0 &&
        (!errorType || n.errorType === errorType)
      );

      if (withNotes.length === 0) return null;

      const insights = withNotes.flatMap(n =>
        n.ruminationNotes.slice(-2).map(r => `- [${n.id}] ${r.insight}`)
      ).slice(0, 5);

      return `Rumination insights:\n${insights.join('\n')}`;
    } catch {
      return null;
    }
  }

  /**
   * Clear caches (useful after digest or research update)
   */
  invalidateCache() {
    this._cache.skills = null;
    this._cache.research = null;
  }
}

module.exports = { KnowledgeEnricher };
