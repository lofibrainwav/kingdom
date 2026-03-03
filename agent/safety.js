/**
 * Octiv Safety Agent — health-monitor + automated-debugging role
 * AC-8 threat detection (lava/fall/infinite-loop), vm2 code validation
 */
const { Blackboard } = require('./blackboard');
const { VM } = require('vm2');

const AC8_THRESHOLDS = {
  lava: {
    minY: 10,
    lavaBlockRadius: 3,
  },
  fall: {
    damageThreshold: 10,   // hearts
    velocityThreshold: -20, // velocity.y
  },
  loop: {
    maxIterations: 50,
    maxRepeatActions: 8,
  },
};

class SafetyAgent {
  constructor() {
    this.id = 'safety';
    this.board = new Blackboard();
    this.actionHistory = [];
    this.reactIterations = 0;
    this.consecutiveFailures = 0;
  }

  async init() {
    await this.board.connect();
    console.log('[Safety] initialized, AC-8 monitoring started');
  }

  // AC-8.1: Threat detection
  detectThreat(bot) {
    const pos = bot.entity.position;
    const vel = bot.entity.velocity;

    // Lava detection
    if (pos.y < AC8_THRESHOLDS.lava.minY) {
      return { type: 'lava', reason: `Y=${Math.floor(pos.y)} < 10` };
    }
    const lavaBlock = bot.findBlock({ matching: bot.registry.blocksByName.lava?.id, maxDistance: 3 });
    if (lavaBlock) {
      return { type: 'lava', reason: 'lava detected within 3 blocks' };
    }

    // Fall detection
    if (vel.y < AC8_THRESHOLDS.fall.velocityThreshold) {
      return { type: 'fall', reason: `velocity.y=${vel.y.toFixed(2)}` };
    }
    if (bot.health <= (20 - AC8_THRESHOLDS.fall.damageThreshold)) {
      return { type: 'fall', reason: `health ${bot.health}/20` };
    }

    // Infinite loop detection
    if (this.reactIterations >= AC8_THRESHOLDS.loop.maxIterations) {
      return { type: 'loop', reason: `ReAct iterations: ${this.reactIterations}` };
    }
    if (this.actionHistory.length >= 8) {
      const last8 = this.actionHistory.slice(-8);
      if (new Set(last8).size === 1) {
        return { type: 'loop', reason: `same action repeated 8 times: ${last8[0]}` };
      }
    }

    return null;
  }

  // AC-8.3: vm2 sandbox code validation (3x dry-run)
  async verifySkillCode(code, maxAttempts = 3) {
    let attempts = 0;
    while (attempts < maxAttempts) {
      try {
        const vm = new VM({ timeout: 3000, sandbox: {} });
        vm.run(`(async function() { ${code} })`);
        attempts++;
        console.log(`[Safety] vm2 validation passed (${attempts}/${maxAttempts})`);
      } catch (err) {
        console.error(`[Safety] vm2 validation failed (${attempts + 1}/${maxAttempts}):`, err.message);
        return false;
      }
    }
    return true;
  }

  // AC-8: Threat detected → trigger skill creation
  async handleThreat(threat, agentId) {
    console.warn(`[Safety] ⚠️  threat detected: ${threat.type} — ${threat.reason}`);
    this.consecutiveFailures++;

    await this.board.publish('safety:threat', {
      agentId,
      threat,
      consecutiveFailures: this.consecutiveFailures,
    });

    // Broadcast to AC-8 emergency channel
    await this.board.publish('skills:emergency', {
      failureType: threat.type,
      agentId,
      triggerSkillCreation: true,
    });

    // 3 consecutive failures → force Group Reflexion
    if (this.consecutiveFailures >= 3) {
      await this.board.publish('leader:reflexion', {
        type: 'group',
        trigger: 'consecutive_failures_3',
        failureType: threat.type,
      });
    }
  }

  async shutdown() {
    await this.board.disconnect();
  }
}

module.exports = { SafetyAgent };
