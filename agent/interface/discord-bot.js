/**
 * Kingdom Discord Bot — Blackboard <-> Discord bridge
 *
 * Bridges Redis pub/sub events to Discord channels and handles
 * user commands for team monitoring and control.
 *
 * Channels:
 *   #neostarz-live      — real-time bot activity stream (health, movement, actions)
 *   #neostarz-alerts    — threats, failures, reflexion, GoT events
 *   #neostarz-commands  — bot command interface
 *   #neostarz-chat      — agent-to-agent communication
 *   #meta-shinmoongo    — forum: anonymous agent confessions (Joseon Shinmungo)
 *
 * Commands:
 *   !help             — list all NeoStarz commands
 *   !status           — current team state
 *   !team             — list all agents and roles
 *   !assign <agent> <task> — assign task to agent
 *   !reflexion        — trigger group reflexion
 *   !confess <msg>    — post to the Shinmungo forum
 *   !rc <subcmd>      — remote control (status, test, ac, log, agents)
 */

const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const { readFileSync } = require('fs');
const { join } = require('path');
const { Blackboard } = require('../core/blackboard');
const T = require('../../config/timeouts');
const { getLogger } = require('../core/logger');
const log = getLogger();

/** Throttle window for ReAct pulse embeds (ms) */
const REACT_THROTTLE_MS = T.DISCORD_REACT_THROTTLE_MS;

/** Role -> embed color mapping (shared across all embed methods) */
const ROLE_COLORS = {
  leader:   0xe74c3c,
  builder:  0x2ecc71,
  safety:   0xe67e22,
  explorer: 0x3498db,
};
const DEFAULT_COLOR = 0x95a5a6;

/** Extract role name from agent ID string */
function _roleFromAgentId(agentId, explicitRole) {
  return explicitRole || agentId.split('-')[0].replace(/^KingdomBot_/, '');
}

/** Get embed color for a role */
function _roleColor(agentId, explicitRole) {
  return ROLE_COLORS[_roleFromAgentId(agentId, explicitRole)] ?? DEFAULT_COLOR;
}

// Load channel config
function loadConfig() {
  try {
    const raw = readFileSync(join(__dirname, '..', '..', 'config', 'discord.json'), 'utf8');
    return JSON.parse(raw);
  } catch {
    return {
      statusChannel: process.env.DISCORD_STATUS_CHANNEL,
      alertsChannel: process.env.DISCORD_ALERTS_CHANNEL,
      commandsChannel: process.env.DISCORD_COMMANDS_CHANNEL,
      chatChannel: process.env.DISCORD_CHAT_CHANNEL,
      forumChannel: process.env.DISCORD_FORUM_CHANNEL
    };
  }
}

class KingdomDiscordBot {
  constructor(options = {}) {
    this.token = options.token || process.env.DISCORD_TOKEN;
    this.guildId = options.guildId || process.env.DISCORD_GUILD_ID;
    this.config = options.config || loadConfig();
    this.redisUrl = options.redisUrl || process.env.BLACKBOARD_REDIS_URL || 'redis://localhost:6380';

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
      ]
    });

    this.board = null;
    this.subscriber = null;
    this.channels = {};
    this._reactThrottle = new Map();
    this._forumTagCache = new Map();
    this._reconnectAttempts = 0;
  }

  async start() {
    // Connect via Blackboard abstraction
    this.board = new Blackboard(this.redisUrl);
    await this.board.connect();
    this.subscriber = await this.board.createSubscriber();

    // Connect Discord
    await this.client.login(this.token);

    this.client.once('ready', () => {
      log.info('discord', `logged in as ${this.client.user.tag}`);
      this._reconnectAttempts = 0;
      this._resolveChannels();
      this._subscribeBlackboard();
    });

    this.client.on('messageCreate', (msg) => this._handleCommand(msg));
    this.client.on('error', (err) => {
      log.error('discord', 'client error', { error: err.message });
    });
    this.client.on('disconnect', () => {
      log.warn('discord', 'disconnected, attempting reconnect');
      this._reconnect().catch(err => log.error('discord', 'reconnect error', { error: err.message }));
    });
  }

  async stop() {
    if (this.subscriber) await this.subscriber.disconnect();
    if (this.board) await this.board.disconnect();
    if (this.client) this.client.destroy();
    log.info('discord', 'disconnected');
  }

  // --- Reconnection ---

  async _reconnect() {
    if (this._reconnectAttempts >= T.MAX_RECONNECT_ATTEMPTS) {
      log.error('discord', 'max reconnect attempts reached, giving up');
      return;
    }
    this._reconnectAttempts++;
    const delay = Math.min(
      T.BASE_RECONNECT_DELAY_MS * Math.pow(2, this._reconnectAttempts - 1),
      T.DISCORD_RECONNECT_CAP_MS
    );
    log.info('discord', `reconnect attempt ${this._reconnectAttempts}/${T.MAX_RECONNECT_ATTEMPTS} in ${delay}ms`);
    await new Promise(r => setTimeout(r, delay));
    try {
      await this.client.login(this.token);
      this._reconnectAttempts = 0;
      log.info('discord', 'reconnected successfully');
    } catch (err) {
      log.error('discord', 'reconnect failed', { error: err.message });
      this._reconnect().catch(e => log.error('discord', 'recursive reconnect error', { error: e.message }));
    }
  }

  // --- Channel Resolution ---

  _resolveChannels() {
    const guild = this.client.guilds.cache.get(this.guildId);
    if (!guild) {
      log.error('discord', 'guild not found', { guildId: this.guildId });
      return;
    }

    const resolve = (id, name) => {
      const channel = id ? guild.channels.cache.get(id) : null;
      if (!channel) {
        log.warn('discord', `channel "${name}" not configured or not found`, { channelId: id || 'empty' });
      }
      return channel;
    };

    this.channels.status = resolve(this.config.statusChannel, 'status');
    this.channels.alerts = resolve(this.config.alertsChannel, 'alerts');
    this.channels.commands = resolve(this.config.commandsChannel, 'commands');
    this.channels.chat = resolve(this.config.chatChannel, 'chat');
    this.channels.forum = resolve(this.config.forumChannel, 'forum');

    // Cache forum tags for matching confessions to tags (clear stale entries on reconnect)
    if (this.channels.forum && this.channels.forum.availableTags) {
      this._forumTagCache.clear();
      for (const tag of this.channels.forum.availableTags) {
        this._forumTagCache.set(tag.name.toLowerCase(), tag.id);
      }
      log.info('discord', 'forum tags cached', {
        tags: Array.from(this._forumTagCache.keys()).join(', ') || 'none'
      });
    }

    log.info('discord', 'channels resolved', {
      channels: Object.entries(this.channels)
        .map(([k, v]) => `${k}=${v ? v.name : 'N/A'}`)
        .join(', ')
    });
  }

  // --- Blackboard -> Discord Bridge ---

  _subscribeBlackboard() {
    // Agent status updates -> #neostarz-live
    this.subscriber.pSubscribe('*:status', (message, channel) => {
      try {
        const data = typeof message === 'string' ? JSON.parse(message) : message;
        this._postStatusEmbed(channel, data);
      } catch (err) {
        log.error('discord', 'failed to parse status message', { error: err.message });
      }
    });

    // Agent health updates -> #neostarz-live
    this.subscriber.pSubscribe('agent:*:health', (message, channel) => {
      try {
        const data = typeof message === 'string' ? JSON.parse(message) : message;
        data.agentId = data.agentId || _extractAgentId(channel);
        this._postHealthEmbed(data);
      } catch (err) {
        log.error('discord', 'failed to parse health message', { error: err.message });
      }
    });

    // Agent inventory updates -> #neostarz-live
    this.subscriber.pSubscribe('agent:*:inventory', (message, channel) => {
      try {
        const data = typeof message === 'string' ? JSON.parse(message) : message;
        data.agentId = data.agentId || _extractAgentId(channel);
        this._postInventoryEmbed(data);
      } catch (err) {
        log.error('discord', 'failed to parse inventory message', { error: err.message });
      }
    });

    // Agent ReAct pulses -> #neostarz-live (throttled)
    this.subscriber.pSubscribe('agent:*:react', (message, channel) => {
      try {
        const data = typeof message === 'string' ? JSON.parse(message) : message;
        data.agentId = data.agentId || _extractAgentId(channel);
        this._postReactPulse(data);
      } catch (err) {
        log.error('discord', 'failed to parse react message', { error: err.message });
      }
    });

    // Safety threats -> #neostarz-alerts
    this.subscriber.subscribe('governance:safety:threat', (message) => {
      try {
        this._postAlertEmbed('threat', typeof message === 'string' ? JSON.parse(message) : message);
      } catch (err) {
        log.error('discord', 'failed to parse threat message', { error: err.message });
      }
    });

    // Reflexion events -> #neostarz-alerts
    this.subscriber.subscribe('knowledge:reflexion:triggered', (message) => {
      try {
        this._postAlertEmbed('reflexion', typeof message === 'string' ? JSON.parse(message) : message);
      } catch (err) {
        log.error('discord', 'failed to parse reflexion message', { error: err.message });
      }
    });

    // Emergency skill creation -> #neostarz-alerts
    this.subscriber.subscribe('knowledge:skills:deployed', (message) => {
      try {
        this._postSkillEmbed(typeof message === 'string' ? JSON.parse(message) : message);
      } catch (err) {
        log.error('discord', 'failed to parse emergency skill message', { error: err.message });
      }
    });

    // GoT reasoning complete -> #neostarz-alerts
    this.subscriber.subscribe('knowledge:got:completed', (message) => {
      try {
        this._postAlertEmbed('got', typeof message === 'string' ? JSON.parse(message) : message);
      } catch (err) {
        log.error('discord', 'failed to parse GoT message', { error: err.message });
      }
    });

    // Agent confessions -> #meta-shinmoongo (forum threads)
    this.subscriber.pSubscribe('agent:*:confess', (message, channel) => {
      if (!this.channels.forum) return;
      try {
        const data = typeof message === 'string' ? JSON.parse(message) : message;
        data.agentId = data.agentId || _extractAgentId(channel);
        this._postShinmungo(data).catch(err =>
          log.error('discord', 'failed to post shinmungo', { error: err.message })
        );
      } catch (err) {
        log.error('discord', 'failed to parse confess message', { error: err.message });
      }
    });

    // Agent-to-agent chat -> #neostarz-chat
    this.subscriber.pSubscribe('agent:*:chat', (message, channel) => {
      try {
        const data = typeof message === 'string' ? JSON.parse(message) : message;
        data.agentId = data.agentId || _extractAgentId(channel);
        this._postChatMessage(data);
      } catch (err) {
        log.error('discord', 'failed to parse chat message', { error: err.message });
      }
    });

    log.info('discord', 'blackboard subscriptions active');
  }

  // --- Embed Methods ---

  _postStatusEmbed(channel, data) {
    if (!this.channels.status) return;

    const embed = new EmbedBuilder()
      .setTitle(`Agent Status: ${data.agentId || 'unknown'}`)
      .setColor(data.health > 10 ? 0x00ff00 : 0xff0000)
      .addFields(
        { name: 'Position', value: formatPos(data.position), inline: true },
        { name: 'Health', value: `${data.health || '?'}/20`, inline: true },
        { name: 'Task', value: data.task || 'idle', inline: true }
      )
      .setTimestamp();

    this.channels.status.send({ embeds: [embed] }).catch(logSendError);
  }

  _postHealthEmbed(data) {
    if (!this.channels.status) return;

    const hp = data.health || 0;
    const food = data.food || 0;
    const color = hp > 14 ? 0x2ecc71 : hp > 7 ? 0xf39c12 : 0xe74c3c;
    const hpBar = '\u2764'.repeat(Math.ceil(hp / 2)) + '\uD83D\uDDA4'.repeat(10 - Math.ceil(hp / 2));
    const foodBar = '\uD83C\uDF57'.repeat(Math.ceil(food / 2)) + '\uD83E\uDDB4'.repeat(10 - Math.ceil(food / 2));

    const embed = new EmbedBuilder()
      .setTitle(`${data.agentId || 'unknown'} Health`)
      .setColor(color)
      .addFields(
        { name: 'HP', value: `${hpBar} ${hp}/20`, inline: false },
        { name: 'Food', value: `${foodBar} ${food}/20`, inline: false },
        { name: 'Position', value: formatPos(data.position), inline: true }
      )
      .setTimestamp();

    this.channels.status.send({ embeds: [embed] }).catch(logSendError);
  }

  _postInventoryEmbed(data) {
    if (!this.channels.status) return;

    const items = data.items || [];
    const itemList = items.length > 0
      ? items.map(i => `${i.name} x${i.count}`).join('\n')
      : 'Empty inventory';

    const embed = new EmbedBuilder()
      .setTitle(`${data.agentId || 'unknown'} Inventory`)
      .setColor(0x3498db)
      .setDescription(itemList)
      .setTimestamp();

    if (data.woodCount !== undefined) {
      embed.addFields({ name: 'Wood', value: `${data.woodCount}`, inline: true });
    }
    if (data.tools) {
      embed.addFields({ name: 'Tools', value: data.tools.join(', ') || 'None', inline: true });
    }

    this.channels.status.send({ embeds: [embed] }).catch(logSendError);
  }

  _postReactPulse(data) {
    if (!this.channels.status) return;

    const agentId = data.agentId || 'unknown';
    const now = Date.now();
    const last = this._reactThrottle.get(agentId) || 0;

    if (now - last < REACT_THROTTLE_MS) return;
    this._reactThrottle.set(agentId, now);

    const embed = new EmbedBuilder()
      .setTitle(`${agentId} Activity`)
      .setColor(0x9b59b6)
      .setDescription(`ReAct iteration #${data.iteration || '?'}`)
      .setTimestamp();

    if (data.action) {
      embed.addFields({ name: 'Action', value: data.action, inline: true });
    }

    this.channels.status.send({ embeds: [embed] }).catch(logSendError);
  }

  _postMilestoneEmbed(data) {
    if (!this.channels.status) return;

    const embed = new EmbedBuilder()
      .setTitle(`${data.agentId || 'unknown'} Milestone`)
      .setColor(0xf1c40f)
      .setDescription(data.message || data.description || JSON.stringify(data))
      .setTimestamp();

    if (data.position) {
      embed.addFields({ name: 'Position', value: formatPos(data.position), inline: true });
    }
    if (data.items) {
      embed.addFields({ name: 'Items', value: data.items, inline: true });
    }

    this.channels.status.send({ embeds: [embed] }).catch(logSendError);
  }

  _postSkillEmbed(data) {
    if (!this.channels.alerts) return;

    const embed = new EmbedBuilder()
      .setTitle('New Skill Learned')
      .setColor(0x1abc9c)
      .setDescription(data.skillName || data.name || 'unknown skill')
      .setTimestamp();

    if (data.agentId) {
      embed.addFields({ name: 'Agent', value: data.agentId, inline: true });
    }
    if (data.errorType) {
      embed.addFields({ name: 'Error Type', value: data.errorType, inline: true });
    }
    if (data.trigger) {
      embed.addFields({ name: 'Trigger', value: data.trigger, inline: true });
    }

    this.channels.alerts.send({ embeds: [embed] }).catch(logSendError);
  }

  _postAlertEmbed(type, data) {
    if (!this.channels.alerts) return;

    const isUrgent = type === 'threat';
    const titles = {
      threat: 'THREAT DETECTED',
      reflexion: 'Group Reflexion Triggered',
      got: 'GoT Reasoning Complete',
    };
    const colors = {
      threat: 0xff0000,
      reflexion: 0xffaa00,
      got: 0x9b59b6,
    };

    const embed = new EmbedBuilder()
      .setTitle(titles[type] || `Alert: ${type}`)
      .setColor(colors[type] || 0x95a5a6)
      .setDescription(data.description || data.message || JSON.stringify(data))
      .setTimestamp();

    if (data.agentId) embed.addFields({ name: 'Agent', value: data.agentId, inline: true });
    if (data.threatType) embed.addFields({ name: 'Type', value: data.threatType, inline: true });
    if (data.totalSynergies !== undefined) {
      embed.addFields({ name: 'Synergies', value: `${data.totalSynergies}`, inline: true });
    }
    if (data.totalGaps !== undefined) {
      embed.addFields({ name: 'Gaps', value: `${data.totalGaps}`, inline: true });
    }

    const content = isUrgent ? '@here' : '';
    this.channels.alerts.send({ content, embeds: [embed] }).catch(logSendError);
  }

  /**
   * Post a confession to the Shinmungo forum as a new thread.
   * Agents publish to kingdom:agent:<id>:confess with:
   *   { title, message, tag?, anonymous? }
   */
  async _postShinmungo(data) {
    if (!this.channels.forum) return;

    const agent = data.agentId || 'unknown';
    const anonymous = data.anonymous === true;
    const displayName = anonymous ? `Agent #${_anonymousHash(agent)}` : agent;
    const color = anonymous ? DEFAULT_COLOR : _roleColor(agent, data.role);
    const body = (data.message || data.text || '...').slice(0, 4096);

    const embed = new EmbedBuilder()
      .setAuthor({ name: displayName })
      .setColor(color)
      .setDescription(body)
      .setTimestamp();

    if (data.context) {
      embed.addFields({ name: 'Context', value: data.context, inline: false });
    }
    if (!anonymous && data.position) {
      embed.addFields({ name: 'Position', value: formatPos(data.position), inline: true });
    }
    if (data.mood) {
      embed.setFooter({ text: `mood: ${data.mood}` });
    }

    // Match tag name to cached tag ID (single lookup)
    const appliedTags = [];
    const tagId = data.tag ? this._forumTagCache.get(data.tag.toLowerCase()) : undefined;
    if (tagId !== undefined) appliedTags.push(tagId);

    const title = data.title || `${displayName}'s confession`;

    try {
      await this.channels.forum.threads.create({
        name: title.slice(0, 100),
        message: { embeds: [embed] },
        appliedTags,
      });
    } catch (err) {
      logSendError(err);
    }
  }

  _postChatMessage(data) {
    if (!this.channels.chat) return;

    const agent = data.agentId || 'unknown';
    const color = _roleColor(agent, data.role);

    const embed = new EmbedBuilder()
      .setAuthor({ name: agent })
      .setColor(color)
      .setDescription(data.message || data.text || '...')
      .setTimestamp();

    if (data.to) {
      embed.setFooter({ text: `to ${data.to}` });
    }

    this.channels.chat.send({ embeds: [embed] }).catch(logSendError);
  }

  // --- Discord Commands ---

  async _handleCommand(msg) {
    if (msg.author.bot) return;
    if (!msg.content.startsWith('!')) return;

    const [cmd, ...args] = msg.content.slice(1).split(/\s+/);

    switch (cmd) {
      case 'help':
        return this._cmdHelp(msg);
      case 'status':
        return this._cmdStatus(msg);
      case 'assign':
        return this._cmdAssign(msg, args);
      case 'reflexion':
        return this._cmdReflexion(msg);
      case 'team':
        return this._cmdTeam(msg);
      case 'confess':
        return this._cmdConfess(msg, args);
      case 'rc':
        return this._cmdRc(msg, args);
      default:
        return; // ignore unknown commands
    }
  }

  async _cmdHelp(msg) {
    const embed = new EmbedBuilder()
      .setTitle('Kingdom Command Surface')
      .setColor(0x3498db)
      .setDescription('Control planning, execution, knowledge, and governance flows in the Kingdom operating system')
      .addFields(
        { name: '!help', value: 'Show this help message', inline: false },
        { name: '!status', value: 'Current system state across active agents and planes', inline: false },
        { name: '!team', value: 'List all agents and their roles', inline: false },
        { name: '!assign <agent> <task>', value: 'Send new work intake into the planning plane', inline: false },
        { name: '!reflexion', value: 'Trigger a shared reflexion cycle for learning and review', inline: false },
        { name: '!rc <subcmd>', value: 'Remote control: status, test, ac, log, agents', inline: false },
        { name: '!confess <message>', value: 'Record a reflection in the Shinmungo forum', inline: false }
      )
      .setTimestamp();

    msg.reply({ embeds: [embed] });
  }

  async _cmdStatus(msg) {
    try {
      // Get agent registry and build status from Blackboard
      const registry = await this.board.getHash('agents:registry');
      const statuses = [];

      if (registry && Object.keys(registry).length > 0) {
        for (const id of Object.keys(registry)) {
          const status = await this.board.get(`agent:${id}:status`);
          if (status) statuses.push(status);
        }
      }

      if (statuses.length === 0) {
        return msg.reply('No active Kingdom agents are reporting state.');
      }

      const embed = new EmbedBuilder()
        .setTitle('Kingdom System Status')
        .setColor(0x3498db)
        .setTimestamp();

      for (const s of statuses) {
        embed.addFields({
          name: s.agentId || 'unknown',
          value: `HP: ${s.health || '?'}/20 | Task: ${s.task || 'idle'} | Pos: ${formatPos(s.position)}`,
          inline: false
        });
      }

      msg.reply({ embeds: [embed] });
    } catch (err) {
      msg.reply(`Error fetching status: ${err.message}`);
    }
  }

  async _cmdAssign(msg, args) {
    if (args.length < 2) {
      return msg.reply('Usage: `!assign <agentId> <task>`');
    }

    const [agentId, ...taskParts] = args;
    const task = taskParts.join(' ');

    try {
      await this.board.publish('work:intake', {
        author: 'discord-bot',
        agentId,
        task: task,
      });
      msg.reply(`Task "${task}" assigned to ${agentId}`);
    } catch (err) {
      msg.reply(`Error assigning task: ${err.message}`);
    }
  }

  async _cmdReflexion(msg) {
    try {
      await this.board.publish('knowledge:reflexion:triggered', {
        author: 'discord-bot',
        trigger: 'manual',
        requestedBy: msg.author.tag,
      });
      msg.reply('Group Reflexion triggered.');
    } catch (err) {
      msg.reply(`Error triggering reflexion: ${err.message}`);
    }
  }

  async _cmdConfess(msg, args) {
    if (args.length === 0) {
      return msg.reply('Usage: `!confess <message>` — Post to the Shinmungo forum');
    }
    const text = args.join(' ');
    await this._postShinmungo({
      agentId: `human:${msg.author.username}`,
      title: `${msg.author.username}'s voice`,
      message: text,
      tag: 'thoughts',
    });
    await msg.reply('Your voice has been heard at the Shinmungo.');
  }

  async _cmdTeam(msg) {
    try {
      const registryHash = await this.board.getHash('agents:registry');
      let agents;

      if (registryHash && Object.keys(registryHash).length > 0) {
        agents = Object.entries(registryHash).map(([id, raw]) => {
          try {
            const data = JSON.parse(raw);
            return { id, role: data.role || 'unknown' };
          } catch (parseErr) {
            log.warn('discord-bot', 'Failed to parse agent registry entry', { id, error: parseErr.message });
            return { id, role: 'unknown' };
          }
        });
      } else {
        agents = [
          { id: 'KingdomBot_leader-01', role: 'leader' },
          { id: 'KingdomBot_builder-01', role: 'builder' },
          { id: 'KingdomBot_builder-02', role: 'builder' },
          { id: 'KingdomBot_builder-03', role: 'builder' },
          { id: 'KingdomBot_safety-01', role: 'safety' },
          { id: 'KingdomBot_explorer-01', role: 'explorer' }
        ];
      }

      const embed = new EmbedBuilder()
        .setTitle('Kingdom Agent Team')
        .setColor(0x9b59b6)
        .setDescription(agents.map(a => `**${a.id}** \u2014 ${a.role}`).join('\n'))
        .setTimestamp();

      msg.reply({ embeds: [embed] });
    } catch (err) {
      msg.reply(`Error fetching team: ${err.message}`);
    }
  }

  // --- Remote Control ---

  async _cmdRc(msg, args) {
    const subcmd = (args[0] || 'status').toLowerCase();
    const supported = ['status', 'test', 'ac', 'log', 'agents'];

    if (!supported.includes(subcmd)) {
      return msg.reply(`Unknown RC subcommand: \`${subcmd}\`. Available: ${supported.join(', ')}`);
    }

    try {
      const requestId = `rc:response:${Date.now()}`;

      // Publish RC command to Blackboard
      await this.board.publish(`rc:cmd:${subcmd}`, {
        author: 'discord-bot',
        requestId,
        subcmd,
        requestedBy: msg.author?.tag || 'unknown',
      });

      // Wait for response with timeout
      const response = await this._waitForRcResponse(requestId, T.RC_RESPONSE_TIMEOUT_MS);

      if (!response) {
        return msg.reply(`RC \`${subcmd}\`: no response (timeout ${T.RC_RESPONSE_TIMEOUT_MS / 1000}s). Is the team running?`);
      }

      const embed = new EmbedBuilder()
        .setTitle(`RC: ${subcmd}`)
        .setColor(0x2ecc71)
        .setDescription(typeof response.data === 'string'
          ? response.data
          : '```json\n' + JSON.stringify(response.data, null, 2).slice(0, 1900) + '\n```')
        .setTimestamp();

      msg.reply({ embeds: [embed] });
    } catch (err) {
      msg.reply(`RC error: ${err.message}`);
    }
  }

  async _waitForRcResponse(requestId, timeoutMs) {
    return new Promise(async (resolve) => {
      const timeout = setTimeout(() => {
        if (sub) sub.disconnect().catch(() => {});
        resolve(null);
      }, timeoutMs);

      let sub;
      try {
        sub = await this.board.createSubscriber();
        await sub.subscribe(requestId, (message) => {
          clearTimeout(timeout);
          sub.disconnect().catch(() => {});
          resolve(typeof message === 'string' ? { data: message } : message);
        });
      } catch (subErr) {
        clearTimeout(timeout);
        log.error('discord-bot', 'Failed to set up pub/sub subscription', { error: subErr.message });
        resolve(null);
      }
    });
  }
}

// --- Helpers ---

/** Extract agent ID from channel like "kingdom:agent:builder-01:react" */
function _extractAgentId(channel) {
  const parts = (channel || '').split(':');
  // Pattern: PREFIX + agent:<id>:<event>
  const agentIdx = parts.indexOf('agent');
  return (agentIdx >= 0 && parts[agentIdx + 1]) ? parts[agentIdx + 1] : 'unknown';
}

/** Generate a stable anonymous number from agent ID (1-99) */
function _anonymousHash(agentId) {
  let hash = 0;
  for (let i = 0; i < agentId.length; i++) {
    hash = ((hash << 5) - hash) + agentId.charCodeAt(i);
    hash |= 0;
  }
  return (Math.abs(hash) % 99) + 1;
}

function formatPos(pos) {
  if (!pos) return 'unknown';
  return `${Math.round(pos.x)}, ${Math.round(pos.y)}, ${Math.round(pos.z)}`;
}

function logSendError(err) {
  log.error('discord', 'failed to send message', { error: err.message });
}

module.exports = { KingdomDiscordBot, REACT_THROTTLE_MS, ROLE_COLORS, DEFAULT_COLOR, _anonymousHash, _roleColor };

// --- CLI Entry Point ---

if (require.main === module) {
  const bot = new KingdomDiscordBot();
  bot.start().catch((err) => {
    log.error('discord', 'failed to start', { error: err.message });
    process.exit(1);
  });

  process.on('SIGINT', async () => {
    await bot.stop();
    process.exit(0);
  });
}
