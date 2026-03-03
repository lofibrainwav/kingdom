/**
 * Octiv Leader Agent — strategy-engine role
 * Goal decomposition, Training/Creative mode decision, vote aggregation
 */
const { Blackboard } = require('./blackboard');

class LeaderAgent {
  constructor(teamSize = 3) {
    this.id = 'leader';
    this.teamSize = teamSize;
    this.board = new Blackboard();
    this.votes = [];
    this.mode = 'training'; // training | creative
  }

  async init() {
    await this.board.connect();
    console.log('[Leader] initialized, team size:', this.teamSize);
  }

  // Decide mode based on AC progress
  async decideMode(agentId) {
    const acData = await this.board.getACProgress(agentId);
    const total = Object.keys(acData).length;
    const done = Object.values(acData).filter(v => JSON.parse(v).status === 'done').length;
    const progress = total > 0 ? done / total : 0;

    this.mode = (progress >= 0.7 || this.votes.length >= Math.ceil(this.teamSize * 2 / 3))
      ? 'creative'
      : 'training';

    await this.board.publish('leader:mode', { mode: this.mode, progress });
    console.log(`[Leader] mode: ${this.mode} (progress: ${Math.floor(progress * 100)}%)`);
    return this.mode;
  }

  // Aggregate team votes
  async collectVote(agentId, vote) {
    this.votes.push({ agentId, vote, ts: Date.now() });
    await this.board.publish('leader:votes', { votes: this.votes });
    console.log(`[Leader] vote received: ${agentId} → ${vote}`);
  }

  // Force Group Reflexion (on 3 consecutive failures)
  async forceGroupReflexion(failureLog) {
    console.warn('[Leader] ⚠️  forcing Group Reflexion!');
    await this.board.publish('leader:reflexion', {
      type: 'group',
      trigger: 'consecutive_failures',
      failureLog,
    });
  }

  async shutdown() {
    await this.board.disconnect();
  }
}

module.exports = { LeaderAgent };
