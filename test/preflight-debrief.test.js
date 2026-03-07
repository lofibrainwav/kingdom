/**
 * Tests for preflight.js and debrief.js core logic.
 * These are utility scripts — we test the logic, not the full execution.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// ── preflight.js logic tests ─────────────────────────────────

describe('preflight.js — core logic', () => {
  const preflightSrc = fs.readFileSync(
    path.join(__dirname, '..', 'scripts', 'preflight.js'), 'utf-8'
  );

  it('should have all 6 check categories', () => {
    assert.ok(preflightSrc.includes('[1/6] Infrastructure'));
    assert.ok(preflightSrc.includes('[2/6] Codebase Integrity'));
    assert.ok(preflightSrc.includes('[3/6] MCP Tools'));
    assert.ok(preflightSrc.includes('[4/6] Skills & Knowledge'));
    assert.ok(preflightSrc.includes('[5/6] Clockwork Automation'));
    assert.ok(preflightSrc.includes('[6/6] Security'));
  });

  it('should cap confidence at 100%', () => {
    assert.ok(preflightSrc.includes('Math.min(100,'));
  });

  it('should guard against divide-by-zero', () => {
    assert.ok(preflightSrc.includes('totalWeight === 0'));
  });

  it('should exit 0 for 90%+ and 1 for below', () => {
    assert.ok(preflightSrc.includes('confidence >= 90 ? 0 : 1'));
  });

  it('should not leak tokens in curl commands', () => {
    // Token should be referenced via $ENV, not interpolated
    const obsidianCheck = preflightSrc.match(/curl.*OBSIDIAN/);
    assert.ok(obsidianCheck, 'should have Obsidian curl check');
    assert.ok(!preflightSrc.includes('Bearer ${token}'), 'should not interpolate token directly');
    assert.ok(preflightSrc.includes('$OBSIDIAN_API_KEY'), 'should use env var reference');
  });

  it('should exclude self from secret scan', () => {
    assert.ok(preflightSrc.includes("grep -v 'preflight.js'"));
  });

  it('should have weighted checks (not just pass/fail)', () => {
    const weightMatches = preflightSrc.match(/check\([^,]+,\s*\d+/g);
    assert.ok(weightMatches && weightMatches.length >= 15, `should have 15+ weighted checks, found ${weightMatches?.length}`);
  });
});

// ── debrief.js logic tests ───────────────────────────────────

describe('debrief.js — core logic', () => {
  const debriefSrc = fs.readFileSync(
    path.join(__dirname, '..', 'scripts', 'debrief.js'), 'utf-8'
  );

  it('should have all 5 analysis sections', () => {
    assert.ok(debriefSrc.includes('[1] Accomplishments'));
    assert.ok(debriefSrc.includes('[2] Combat Power'));
    assert.ok(debriefSrc.includes('[3] Lessons Learned'));
    assert.ok(debriefSrc.includes('[4] Prevention'));
    assert.ok(debriefSrc.includes('[5] Session Footprint'));
  });

  it('should have baseline fallback for no commits today', () => {
    assert.ok(debriefSrc.includes("HEAD~10"), 'should fall back to HEAD~10');
  });

  it('should support --save flag for vault persistence', () => {
    assert.ok(debriefSrc.includes("'--save'"));
    assert.ok(debriefSrc.includes('debrief-${date}.md'));
  });

  it('should generate frontmatter when saving', () => {
    assert.ok(debriefSrc.includes('tags: [type/debrief'));
    assert.ok(debriefSrc.includes('related: ["[[kingdom/infrastructure]]"'));
  });

  it('should detect bug fix patterns', () => {
    assert.ok(debriefSrc.includes('fix|bug|patch|repair'));
  });

  it('should detect automation patterns', () => {
    assert.ok(debriefSrc.includes('auto|clock|cron|schedule|pipeline'));
  });

  it('should not use arbitrary XP numbers', () => {
    // Session footprint should be descriptive, not point-based
    assert.ok(debriefSrc.includes('Session Footprint'));
    assert.ok(!debriefSrc.includes('totalXP'), 'should not have arbitrary XP calculation');
  });
});

// ── vault-health.js --fix logic tests ────────────────────────

describe('vault-health.js — auto-fix logic', () => {
  const healthSrc = fs.readFileSync(
    path.join(__dirname, '..', 'scripts', 'vault-health.js'), 'utf-8'
  );

  it('should have --fix flag support', () => {
    assert.ok(healthSrc.includes("'--fix'"));
    assert.ok(healthSrc.includes('doFix'));
  });

  it('should have FOLDER_LINKS and FOLDER_TAGS maps', () => {
    assert.ok(healthSrc.includes('FOLDER_LINKS'));
    assert.ok(healthSrc.includes('FOLDER_TAGS'));
  });

  it('should have error handling in fixFrontmatter', () => {
    assert.ok(healthSrc.includes('try {'), 'should have try block');
    assert.ok(healthSrc.includes('SKIP frontmatter'), 'should skip on error');
  });

  it('should have error handling in fixOrphans', () => {
    assert.ok(healthSrc.includes('SKIP orphan'), 'should skip orphans on error');
  });

  it('should skip files with existing frontmatter', () => {
    // Even if malformed, don't double-prepend
    assert.ok(healthSrc.includes("content.startsWith('---')"));
  });
});
