/**
 * Event Schema Coverage Test
 * Verifies that every published event channel has a schema definition,
 * ensuring runtime validation covers the entire event surface.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { SCHEMAS, getSchemaForChannel, validateEventPayload } = require('../agent/core/event-schemas');

function findInDir(dir) {
  let files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...findInDir(full));
    else if (entry.name.endsWith('.js')) files.push(full);
  }
  return files;
}

function extractPublishedChannels() {
  const agentDir = path.join(__dirname, '..', 'agent');
  const files = findInDir(agentDir);
  const channels = new Set();
  const pubRe = /publish\(\s*['"]([^'"]+)['"]/g;

  for (const file of files) {
    const src = fs.readFileSync(file, 'utf-8');
    let m;
    while ((m = pubRe.exec(src)) !== null) {
      channels.add(m[1]);
    }
  }
  return channels;
}

describe('Event Schema Coverage', () => {
  it('every published channel has a schema definition', () => {
    const published = extractPublishedChannels();
    const missing = [];

    for (const channel of published) {
      const schema = getSchemaForChannel(channel);
      if (!schema) missing.push(channel);
    }

    assert.equal(
      missing.length, 0,
      `Missing schemas for: ${missing.join(', ')}`
    );
  });

  it('every schema has at least one required field', () => {
    for (const [channel, fields] of Object.entries(SCHEMAS)) {
      assert.ok(
        Array.isArray(fields) && fields.length > 0,
        `Schema ${channel} has no required fields`
      );
    }
  });

  it('validateEventPayload throws on missing required fields', () => {
    assert.throws(
      () => validateEventPayload('work:intake', { author: 'test' }),
      /requires field "task"/
    );
  });

  it('validateEventPayload passes with all required fields', () => {
    assert.doesNotThrow(
      () => validateEventPayload('work:intake', { author: 'test', task: 'build' })
    );
  });

  it('wildcard schemas match concrete channels', () => {
    const schema = getSchemaForChannel('rc:cmd:status');
    assert.ok(schema, 'rc:cmd:status should match rc:cmd:*');
    assert.ok(schema.includes('author'));
    assert.ok(schema.includes('requestId'));
  });

  it('unknown channels return null (no validation)', () => {
    const schema = getSchemaForChannel('totally:unknown:channel');
    assert.equal(schema, null);
  });
});
