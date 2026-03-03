/**
 * Octiv Builder Agent — coding-agent + mineflayer role
 * Bot control: wood collection, shelter construction, tool crafting
 */
const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const { Blackboard } = require('./blackboard');

const { GoalNear, GoalBlock } = goals;
const { Vec3 } = require('vec3');

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

  // AC-2: Build 3x3x3 shelter
  async buildShelter() {
    console.log(`[${this.id}] starting shelter construction`);
    const mcData = require('minecraft-data')(this.bot.version);

    // 1. Craft planks from logs
    await this._craftPlanks();

    // 2. Find flat build site
    const origin = await this._findBuildSite();
    if (!origin) throw new Error('No suitable build site found');

    // 3. Set up pathfinder once for all block placements
    this._setupPathfinder();

    // 4. Build shell: floor(y=0), walls(y=1,2), roof(y=3)
    const plankName = 'oak_planks';

    for (let dy = 0; dy <= 3; dy++) {
      for (let dx = 0; dx < 3; dx++) {
        for (let dz = 0; dz < 3; dz++) {
          const isFloor = (dy === 0);
          const isRoof = (dy === 3);
          const isWall = (dy === 1 || dy === 2);
          const isEdge = (dx === 0 || dx === 2 || dz === 0 || dz === 2);
          const isDoor = (dx === 1 && dz === 0 && (dy === 1 || dy === 2));

          if (isDoor) continue;
          if (isFloor || isRoof) { /* place block */ }
          else if (isWall && isEdge) { /* place block */ }
          else continue;

          const pos = origin.offset(dx, dy, dz);
          await this._placeBlockAt(pos, plankName);
        }
      }
    }

    // 4. Publish shelter coords
    this.acProgress[2] = true;
    await this.board.updateAC(this.id, 2, 'done');
    await this.board.publish(`builder:shelter`, {
      position: { x: origin.x, y: origin.y, z: origin.z },
      size: { x: 3, y: 4, z: 3 },
    });
    console.log(`[${this.id}] AC-2 done: shelter at ${origin}`);
  }

  // Craft oak_planks from oak_log in inventory
  async _craftPlanks() {
    const mcData = require('minecraft-data')(this.bot.version);
    const planksRecipe = mcData.itemsByName.oak_planks;
    if (!planksRecipe) return;
    const logItem = this.bot.inventory.items().find(i => i.name === 'oak_log');
    if (!logItem) return;
    const count = Math.min(logItem.count, 9); // up to 9 logs → 36 planks
    for (let i = 0; i < count; i++) {
      await this.bot.craft(planksRecipe, 1, null);
    }
  }

  // Find flat 3x3 site: solid ground + air above (radius 16)
  async _findBuildSite() {
    const botPos = this.bot.entity.position.floored();
    for (let r = 1; r <= 16; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue; // perimeter only
          const base = botPos.offset(dx, -1, dz);
          if (this._isFlatSite(base)) return botPos.offset(dx, 0, dz);
        }
      }
    }
    return null;
  }

  // Check 3x3 ground is solid + 4 layers of air above
  _isFlatSite(groundCorner) {
    for (let x = 0; x < 3; x++) {
      for (let z = 0; z < 3; z++) {
        const ground = this.bot.blockAt(groundCorner.offset(x, 0, z));
        if (!ground || ground.boundingBox !== 'block') return false;
        for (let y = 1; y <= 4; y++) {
          const air = this.bot.blockAt(groundCorner.offset(x, y, z));
          if (air && air.boundingBox === 'block') return false;
        }
      }
    }
    return true;
  }

  // Navigate near and place block (pathfinder movements must be set before calling)
  async _placeBlockAt(pos, blockName) {
    await this.bot.pathfinder.goto(new GoalNear(pos.x, pos.y, pos.z, 4));

    const item = this.bot.inventory.items().find(i => i.name === blockName);
    if (!item) throw new Error(`No ${blockName} in inventory`);
    await this.bot.equip(item, 'hand');

    const referenceBlock = this.bot.blockAt(pos.offset(0, -1, 0));
    if (referenceBlock) {
      await this.bot.placeBlock(referenceBlock, new Vec3(0, 1, 0));
    }
  }

  _setupPathfinder() {
    const movements = new Movements(this.bot);
    this.bot.pathfinder.setMovements(movements);
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
        } else if (!this.acProgress[2]) {
          await this.buildShelter();
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
