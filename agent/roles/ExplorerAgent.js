/**
 * Octiv Explorer Role — Phase 3.5
 * Specialized scouting agent with spiral search pattern.
 */
const { BaseRole } = require('./BaseRole');

class ExplorerAgent extends BaseRole {
  constructor(config = {}) {
    super({ ...config, role: 'explorer' });
    this.discovered = [];
    this.radius = 0;
    this.maxRadius = config.maxRadius || 200;
  }

  async execute(bot) {
    await this.reportStatus('exploring');
    this.radius = Math.min(this.radius + 10, this.maxRadius);

    const pos = bot.entity?.position || { x: 0, y: 64, z: 0 };
    const discovery = {
      radius: this.radius,
      center: { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) },
    };
    this.discovered.push(discovery);

    await this.board.publish(`agent:${this.id}:explored`, discovery);
    return { success: true, radius: this.radius, totalDiscoveries: this.discovered.length };
  }
}

module.exports = { ExplorerAgent };
