/**
 * Kingdom Skill Pipeline — Phase 4.1 + 4.2
 * Failure → LLM skill generation → sandbox validation → deploy to library
 * Dynamic skill library with successRate tracking and daily limits.
 *
 * Sandbox: node:vm with isolated context (replaces vm2 CVE-2023-37466).
 */
const { Blackboard } = require('../core/blackboard');
const T = require('../../config/timeouts');
const { getLogger } = require('../core/logger');
const vm = require('node:vm');
const log = getLogger();

function getDailyLimit() { return parseInt(process.env.SKILL_DAILY_LIMIT) || 5; }
function getMinSuccessRate() { return parseFloat(process.env.SKILL_MIN_SUCCESS_RATE) || 0.7; }

class SkillPipeline {
  constructor(llmClient = null, options = {}) {
    this.board = options.board || new Blackboard();
    this.llmClient = llmClient; // injected LLM client (ReflexionEngine)
    this.dailyCount = 0;
    this.dailyResetAt = Date.now() + T.SKILL_DAILY_RESET_MS;
  }

  async init() {
    await this.board.connect();
    // Load daily count from Redis
    const parsed = await this.board.getConfig('skills:daily_meta');
    if (parsed && parsed.resetAt > Date.now()) {
      this.dailyCount = parsed.count;
      this.dailyResetAt = parsed.resetAt;
    }
    log.info('skill-pipeline', `initialized, daily: ${this.dailyCount}/${getDailyLimit()}`);
  }

  // 4.1: Full pipeline — failure → generate → validate → deploy
  async generateFromFailure(failureContext) {
    this._checkDailyReset();
    if (this.dailyCount >= getDailyLimit()) {
      return { success: false, reason: 'daily_limit_reached' };
    }

    // Generate skill via LLM (fallback if LLM absent or returns null)
    let skillJson;
    if (this.llmClient) {
      skillJson = await this.llmClient.generateSkill(failureContext);
    }
    if (!skillJson) {
      skillJson = this._fallbackSkill(failureContext);
    }

    if (!skillJson || !skillJson.name || !skillJson.code) {
      return { success: false, reason: 'invalid_skill_json' };
    }

    // node:vm sandbox validation
    const valid = await this.validateSkill(skillJson.code);
    if (!valid) {
      return { success: false, reason: 'vm_validation_failed' };
    }

    // Deploy to library
    await this.deploySkill(skillJson);
    this.dailyCount++;
    await this._saveDailyMeta();

    // Broadcast emergency channel
    await this.board.publish('knowledge:skills:deployed', {
      author: 'skill-pipeline',
      newSkill: skillJson.name,
      trigger: failureContext.error,
    });

    log.info('skill-pipeline', `deployed: ${skillJson.name} (${this.dailyCount}/${getDailyLimit()})`);
    return { success: true, skill: skillJson.name };
  }

  // 4.1: Sandbox validation via node:vm (3x dry-run)
  // Blocks: require, process, eval, global — allows only safe Math/JSON/Date
  async validateSkill(code, attempts = 3) {
    for (let i = 0; i < attempts; i++) {
      try {
        const sandbox = vm.createContext({
          Math,
          JSON,
          Date,
          console: { log: () => {} },
          // Explicitly block dangerous globals
          require: undefined,
          process: undefined,
          eval: undefined,
          Function: undefined,
          global: undefined,
        });
        const script = new vm.Script(code);
        script.runInContext(sandbox, { timeout: T.VM_TIMEOUT_MS });
      } catch (err) {
        log.warn('skill-pipeline', `vm validation failed (attempt ${i + 1}/3)`, {
          error: err.message,
        });
        return false;
      }
    }
    log.info('skill-pipeline', 'vm validation passed (3/3)');
    return true;
  }

  // 4.2: Deploy skill to Redis library
  async deploySkill(skillJson) {
    const entry = {
      ...skillJson,
      deployedAt: Date.now(),
      successRate: 1.0,
      uses: 0,
      successes: 0,
    };
    await this.board.saveSkill(skillJson.name, entry);
    return entry;
  }

  // 4.2: Update skill success rate after use
  async updateSuccessRate(skillName, succeeded) {
    const skill = await this.board.getSkill(skillName);
    if (!skill) return null;

    skill.uses++;
    if (succeeded) skill.successes++;
    skill.successRate = skill.uses > 0 ? skill.successes / skill.uses : 0;

    // Discard if success rate drops below threshold
    if (skill.uses >= 3 && skill.successRate < getMinSuccessRate()) {
      await this.board.deleteHashField('skills:library', skillName);
      log.info('skill-pipeline', `discarded: ${skillName} (rate: ${skill.successRate.toFixed(2)})`);
      return { discarded: true, skill: skillName, rate: skill.successRate };
    }

    await this.board.saveSkill(skillName, skill);
    return { discarded: false, skill: skillName, rate: skill.successRate };
  }

  // 4.2: Get all skills from library
  async getLibrary() {
    const all = await this.board.getHash('skills:library');
    const result = {};
    for (const [name, raw] of Object.entries(all)) {
      try { result[name] = JSON.parse(raw); } catch {}
    }
    return result;
  }

  _fallbackSkill(context) {
    const errorType = context.errorType || 'unknown';
    return {
      name: `fallback_${errorType}_v1`,
      code: `// Auto-generated fallback for ${errorType}\nconst retry = true;`,
      description: `Fallback skill for ${context.error}`,
      errorType,
    };
  }

  _checkDailyReset() {
    if (Date.now() >= this.dailyResetAt) {
      this.dailyCount = 0;
      this.dailyResetAt = Date.now() + T.SKILL_DAILY_RESET_MS;
    }
  }

  async _saveDailyMeta() {
    await this.board.setConfig('skills:daily_meta', {
      count: this.dailyCount, resetAt: this.dailyResetAt,
    });
  }

  async shutdown() {
    await this.board.disconnect();
  }
}

module.exports = { SkillPipeline, getDailyLimit, getMinSuccessRate };
