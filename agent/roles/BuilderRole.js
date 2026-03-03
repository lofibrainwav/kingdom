/**
 * Octiv Builder Role — Phase 3.5
 * Specialized construction agent.
 */
const { BaseRole } = require('./BaseRole');

class BuilderRole extends BaseRole {
  constructor(config = {}) {
    super({ ...config, role: 'builder' });
    this.shelterBuilt = false;
  }

  async execute(bot) {
    await this.reportStatus('building');
    await this.board.publish(`agent:${this.id}:building`, {
      action: 'shelter', status: this.shelterBuilt ? 'complete' : 'in_progress',
    });
    return { success: true, shelterBuilt: this.shelterBuilt };
  }

  markShelterComplete() {
    this.shelterBuilt = true;
  }
}

module.exports = { BuilderRole };
