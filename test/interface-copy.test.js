const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { DASHBOARD_HTML } = require('../agent/interface/dashboard');

describe('Interface Copy', () => {
  it('dashboard should expose the Kingdom operating console framing', () => {
    assert.match(DASHBOARD_HTML, /Kingdom Operating Console/);
    assert.match(DASHBOARD_HTML, /Work Plane/);
    assert.match(DASHBOARD_HTML, /Knowledge Plane/);
    assert.match(DASHBOARD_HTML, /Governance Plane/);
  });

  it('discord help copy should reference the Kingdom operating system', () => {
    const source = fs.readFileSync(path.join(__dirname, '../agent/interface/discord-bot.js'), 'utf8');
    assert.match(source, /Kingdom Command Surface/);
    assert.match(source, /planning, execution, knowledge, and governance flows/);
  });
});
