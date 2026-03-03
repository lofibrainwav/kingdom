/**
 * Octiv Builder Agent — coding-agent + mineflayer role
 * Bot control: wood collection, shelter construction, tool crafting
 */
const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const { Blackboard } = require('./blackboard');

const { GoalNear, GoalBlock } = goals;

class BuilderAgent {
  constructor(config = {}) {
    this.id = config.id || 'builder-01';
    this.board = new Blackboard();
    this.bot = null;
    this.reactIterations = 0;
    this.actionHistory = [];
    this.acProgress = { 1: false, 2: false, 3: false, 4: false };
  }

  async init() {
    await this.board.connect();
    this.bot = mineflayer.createBot({
      host: 'localhost',
      port: 25565,
      username: `OctivBot_${this.id}`,
      version: '1.21.1',
      auth: 'offline',
    });

    this.bot.loadPlugin(pathfinder);

    this.bot.once('spawn', () => this._onSpawn());
    this.bot.on('chat', (user, msg) => this._onChat(user, msg));
    this.bot.on('health', () => this._onHealthChange());
    this.bot.on('error', (err) => console.error(`[${this.id}] error:`, err.message));
  }

  async _onSpawn() {
    console.log(`[${this.id}] spawned`);
    await this.board.publish(`agent:${this.id}:status`, {
      status: 'spawned',
      position: this.bot.entity.position,
    });
    // Start ReAct loop
    this._reactLoop();
  }

  // AC-1: Collect 16 wood logs
  async collectWood(count = 16) {
    console.log(`[${this.id}] starting wood collection (target: ${count})`);
    const mcData = require('minecraft-data')(this.bot.version);
    const logIds = ['oak_log', 'spruce_log', 'birch_log'].map(n => mcData.blocksByName[n]?.id).filter(Boolean);

    let collected = 0;
    while (collected < count) {
      const log = this.bot.findBlock({ matching: logIds, maxDistance: 32 });
      if (!log) { await this.bot.waitForTicks(20); continue; }

      const movements = new Movements(this.bot);
      this.bot.pathfinder.setMovements(movements);
      await this.bot.pathfinder.goto(new GoalBlock(log.position.x, log.position.y, log.position.z));
      await this.bot.dig(log);
      collected++;

      await this.board.updateAC(this.id, 1, collected >= count ? 'done' : 'in_progress');
      await this.board.publish(`agent:${this.id}:inventory`, { wood: collected });
    }

    this.acProgress[1] = true;
    console.log(`[${this.id}] ✅ AC-1 done: collected ${collected} wood`);
  }

  // AC-3: Craft basic tools
  async craftBasicTools() {
    await this.bot.craft(this.bot.registry.itemsByName.crafting_table, 1, null);
    await this.bot.craft(this.bot.registry.itemsByName.wooden_pickaxe, 1, null);
    this.acProgress[3] = true;
    await this.board.updateAC(this.id, 3, 'done');
    console.log(`[${this.id}] ✅ AC-3 done: basic tools crafted`);
  }

  // Monitor health changes
  async _onHealthChange() {
    await this.board.publish(`agent:${this.id}:health`, {
      health: this.bot.health,
      food: this.bot.food,
    });
  }

  _onChat(username, message) {
    if (username === this.bot.username) return;
    console.log(`[${this.id}] chat [${username}]: ${message}`);
  }

  // Main ReAct loop
  async _reactLoop() {
    while (true) {
      this.reactIterations++;
      await this.board.publish(`agent:${this.id}:react`, { iteration: this.reactIterations });

      try {
        if (!this.acProgress[1]) {
          await this.collectWood(16);
        } else if (!this.acProgress[3]) {
          await this.craftBasicTools();
        } else {
          // All ACs done — idle
          await this.bot.waitForTicks(40);
        }
      } catch (err) {
        console.error(`[${this.id}] ReAct error:`, err.message);
        await this.board.logReflexion(this.id, { error: err.message, iteration: this.reactIterations });
        await this.bot.waitForTicks(20);
      }
    }
  }

  async shutdown() {
    this.bot?.end();
    await this.board.disconnect();
  }
}

module.exports = { BuilderAgent };
