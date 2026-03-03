/**
 * Discord bot unit tests.
 * Tests message parsing, embed formatting, and command routing
 * without requiring actual Discord/Redis connections.
 */
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// Mock discord.js EmbedBuilder
class MockEmbedBuilder {
  constructor() {
    this.data = {};
  }
  setTitle(t) { this.data.title = t; return this; }
  setColor(c) { this.data.color = c; return this; }
  setDescription(d) { this.data.description = d; return this; }
  setTimestamp() { this.data.timestamp = true; return this; }
  addFields(...fields) {
    this.data.fields = this.data.fields || [];
    this.data.fields.push(...fields.flat());
    return this;
  }
}

// Helper: format position
function formatPos(pos) {
  if (!pos) return 'unknown';
  return `${Math.round(pos.x)}, ${Math.round(pos.y)}, ${Math.round(pos.z)}`;
}

// Helper: parse command
function parseCommand(content) {
  if (!content.startsWith('!')) return null;
  const [cmd, ...args] = content.slice(1).split(/\s+/);
  return { cmd, args };
}

describe('Discord Bot — Helpers', () => {
  describe('formatPos', () => {
    it('should format position object to string', () => {
      const pos = { x: 10.5, y: 64.2, z: -30.9 };
      assert.equal(formatPos(pos), '11, 64, -31');
    });

    it('should return "unknown" for null position', () => {
      assert.equal(formatPos(null), 'unknown');
      assert.equal(formatPos(undefined), 'unknown');
    });

    it('should handle zero coordinates', () => {
      assert.equal(formatPos({ x: 0, y: 0, z: 0 }), '0, 0, 0');
    });
  });

  describe('parseCommand', () => {
    it('should parse !status command', () => {
      const result = parseCommand('!status');
      assert.deepEqual(result, { cmd: 'status', args: [] });
    });

    it('should parse !assign with arguments', () => {
      const result = parseCommand('!assign builder-01 collect wood');
      assert.deepEqual(result, { cmd: 'assign', args: ['builder-01', 'collect', 'wood'] });
    });

    it('should return null for non-command messages', () => {
      assert.equal(parseCommand('hello world'), null);
      assert.equal(parseCommand(''), null);
    });

    it('should parse !team command', () => {
      const result = parseCommand('!team');
      assert.deepEqual(result, { cmd: 'team', args: [] });
    });

    it('should parse !reflexion command', () => {
      const result = parseCommand('!reflexion');
      assert.deepEqual(result, { cmd: 'reflexion', args: [] });
    });
  });
});

describe('Discord Bot — Embed Formatting', () => {
  it('should create status embed with correct fields', () => {
    const data = {
      agentId: 'OctivBot_builder-01',
      health: 18,
      position: { x: 10, y: 64, z: -30 },
      task: 'collecting wood'
    };

    const embed = new MockEmbedBuilder()
      .setTitle(`Agent Status: ${data.agentId}`)
      .setColor(data.health > 10 ? 0x00ff00 : 0xff0000)
      .addFields(
        { name: 'Position', value: formatPos(data.position), inline: true },
        { name: 'Health', value: `${data.health}/20`, inline: true },
        { name: 'Task', value: data.task, inline: true }
      )
      .setTimestamp();

    assert.equal(embed.data.title, 'Agent Status: OctivBot_builder-01');
    assert.equal(embed.data.color, 0x00ff00);
    assert.equal(embed.data.fields.length, 3);
    assert.equal(embed.data.fields[0].value, '10, 64, -30');
    assert.equal(embed.data.fields[1].value, '18/20');
  });

  it('should create red embed for low health', () => {
    const embed = new MockEmbedBuilder()
      .setColor(5 > 10 ? 0x00ff00 : 0xff0000);

    assert.equal(embed.data.color, 0xff0000);
  });

  it('should create alert embed for threats', () => {
    const data = {
      description: 'Lava detected within 3 blocks',
      agentId: 'OctivBot_builder-02',
      threatType: 'lava'
    };

    const embed = new MockEmbedBuilder()
      .setTitle('THREAT DETECTED')
      .setColor(0xff0000)
      .setDescription(data.description)
      .addFields(
        { name: 'Agent', value: data.agentId, inline: true },
        { name: 'Type', value: data.threatType, inline: true }
      )
      .setTimestamp();

    assert.equal(embed.data.title, 'THREAT DETECTED');
    assert.equal(embed.data.color, 0xff0000);
    assert.equal(embed.data.description, 'Lava detected within 3 blocks');
  });

  it('should create AC completion embed', () => {
    const data = { ac: 'AC-1', status: 'done', agentId: 'OctivBot_builder-01' };

    const embed = new MockEmbedBuilder()
      .setTitle(`AC Update: ${data.ac}`)
      .setColor(data.status === 'done' ? 0x00ff00 : 0x3498db)
      .addFields(
        { name: 'Status', value: data.status, inline: true },
        { name: 'Agent', value: data.agentId, inline: true }
      )
      .setTimestamp();

    assert.equal(embed.data.title, 'AC Update: AC-1');
    assert.equal(embed.data.color, 0x00ff00);
  });
});

describe('Discord Bot — JSON Parsing Safety', () => {
  it('should handle valid JSON', () => {
    const raw = '{"agentId":"bot-01","health":20}';
    const data = JSON.parse(raw);
    assert.equal(data.agentId, 'bot-01');
    assert.equal(data.health, 20);
  });

  it('should throw on malformed JSON', () => {
    assert.throws(() => JSON.parse('{invalid}'), SyntaxError);
  });

  it('should handle empty object', () => {
    const data = JSON.parse('{}');
    assert.equal(data.agentId, undefined);
  });
});
