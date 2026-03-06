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
    assert.match(DASHBOARD_HTML, /Knowledge Captures/);
    assert.match(DASHBOARD_HTML, /Skill Evals/);
    assert.match(DASHBOARD_HTML, /Knowledge Feed/);
    assert.match(DASHBOARD_HTML, /Recent captures and skill evaluation outcomes/);
    assert.match(DASHBOARD_HTML, /Task Closeout Feed/);
    assert.match(DASHBOARD_HTML, /Recent completion, review, and retry outcomes/);
    assert.match(DASHBOARD_HTML, /Task Board/);
    assert.match(DASHBOARD_HTML, /Current lifecycle state from stored task configs/);
    assert.match(DASHBOARD_HTML, /Retry Ready/);
    assert.match(DASHBOARD_HTML, /Blocked/);
    assert.match(DASHBOARD_HTML, /Dry-Run Wins/);
    assert.match(DASHBOARD_HTML, /Ready to Promote/);
    assert.match(DASHBOARD_HTML, /Retry Pressure/);
    assert.match(DASHBOARD_HTML, /Category Load/);
    assert.match(DASHBOARD_HTML, /Guardrail Heat/);
    assert.match(DASHBOARD_HTML, /Project Hotspots/);
    assert.match(DASHBOARD_HTML, /Task Hotspots/);
    assert.match(DASHBOARD_HTML, /Reset Focus/);
    assert.match(DASHBOARD_HTML, /Click a retry pressure bucket to focus the board/);
    assert.match(DASHBOARD_HTML, /Latest Lesson/);
    assert.match(DASHBOARD_HTML, /Latest Improvement/);
    assert.match(DASHBOARD_HTML, /Knowledge Capture/);
    assert.match(DASHBOARD_HTML, /Promotion Signal/);
    assert.match(DASHBOARD_HTML, /Knowledge Updated/);
    assert.match(DASHBOARD_HTML, /Dry Run Count/);
    assert.match(DASHBOARD_HTML, /Latest Dry Run/);
    assert.match(DASHBOARD_HTML, /Dry-Run Impact/);
    assert.match(DASHBOARD_HTML, /Project Recovery Rate/);
    assert.match(DASHBOARD_HTML, /Task Recovery Rate/);
    assert.match(DASHBOARD_HTML, /Project Dry-Run Coverage/);
    assert.match(DASHBOARD_HTML, /Dry-Run Assisted Wins/);
    assert.match(DASHBOARD_HTML, /Dry-Run Recovery Gap/);
    assert.match(DASHBOARD_HTML, /Winning Dry-Run Plays/);
    assert.match(DASHBOARD_HTML, /dryRunSummary/);
    assert.match(DASHBOARD_HTML, /history\.replaceState/);
    assert.match(DASHBOARD_HTML, /URLSearchParams/);
  });

  it('discord help copy should reference the Kingdom operating system', () => {
    const source = fs.readFileSync(path.join(__dirname, '../agent/interface/discord-bot.js'), 'utf8');
    assert.match(source, /Kingdom Command Surface/);
    assert.match(source, /planning, execution, knowledge, and governance flows/);
  });
});
