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
    const categories = [
      '[1/6] Infrastructure',
      '[2/6] Codebase Integrity',
      '[3/6] MCP Tools',
      '[4/6] Skills & Knowledge',
      '[5/6] Clockwork Automation',
      '[6/6] Security',
    ];
    for (const cat of categories) {
      assert.equal(preflightSrc.includes(cat), true, `missing category: ${cat}`);
    }
    assert.equal(categories.length, 6);
  });

  it('should cap confidence at 100%', () => {
    assert.match(preflightSrc, /Math\.min\(100,/);
  });

  it('should guard against divide-by-zero', () => {
    assert.match(preflightSrc, /totalWeight === 0/);
  });

  it('should exit 0 for 90%+ and 1 for below', () => {
    assert.match(preflightSrc, /confidence >= 90 \? 0 : 1/);
  });

  it('should not leak tokens in curl commands', () => {
    // Token should be referenced via $ENV, not interpolated
    assert.match(preflightSrc, /curl.*OBSIDIAN/, 'should have Obsidian curl check');
    assert.equal(preflightSrc.includes('Bearer ${token}'), false, 'should not interpolate token directly');
    assert.equal(preflightSrc.includes('$OBSIDIAN_API_KEY'), true, 'should use env var reference');
  });

  it('should exclude self from secret scan', () => {
    assert.match(preflightSrc, /grep -v 'preflight\.js'/);
  });

  it('should have weighted checks (not just pass/fail)', () => {
    const weightMatches = preflightSrc.match(/check\([^,]+,\s*\d+/g);
    assert.notEqual(weightMatches, null, 'should have weighted check() calls');
    assert.equal(weightMatches.length >= 15, true, `should have 15+ weighted checks, found ${weightMatches.length}`);
  });
});

// ── debrief.js logic tests ───────────────────────────────────

describe('debrief.js — core logic', () => {
  const debriefSrc = fs.readFileSync(
    path.join(__dirname, '..', 'scripts', 'debrief.js'), 'utf-8'
  );

  it('should have all 5 analysis sections', () => {
    const sections = [
      '[1] Accomplishments',
      '[2] Combat Power',
      '[3] Lessons Learned',
      '[4] Prevention',
      '[5] Session Footprint',
    ];
    for (const sec of sections) {
      assert.equal(debriefSrc.includes(sec), true, `missing section: ${sec}`);
    }
    assert.equal(sections.length, 5);
  });

  it('should have baseline fallback for no commits today', () => {
    assert.match(debriefSrc, /HEAD~10/, 'should fall back to HEAD~10');
  });

  it('should support --save flag for vault persistence', () => {
    assert.match(debriefSrc, /'--save'/);
    assert.match(debriefSrc, /debrief-\$\{date\}\.md/);
  });

  it('should generate frontmatter when saving', () => {
    assert.match(debriefSrc, /tags: \[type\/debrief/);
    assert.match(debriefSrc, /related: \["\[\[kingdom\/infrastructure\]\]"/);
  });

  it('should detect bug fix patterns', () => {
    assert.match(debriefSrc, /fix\|bug\|patch\|repair/);
  });

  it('should detect automation patterns', () => {
    assert.match(debriefSrc, /auto\|clock\|cron\|schedule\|pipeline/);
  });

  it('should not use arbitrary XP numbers', () => {
    assert.match(debriefSrc, /Session Footprint/);
    assert.equal(debriefSrc.includes('totalXP'), false, 'should not have arbitrary XP calculation');
  });
});

// ── vault-health.js --fix logic tests ────────────────────────

describe('vault-health.js — auto-fix logic', () => {
  const healthSrc = fs.readFileSync(
    path.join(__dirname, '..', 'scripts', 'vault-health.js'), 'utf-8'
  );

  it('should have --fix flag support', () => {
    assert.match(healthSrc, /'--fix'/);
    assert.match(healthSrc, /doFix/);
  });

  it('should have FOLDER_LINKS and FOLDER_TAGS maps', () => {
    assert.match(healthSrc, /FOLDER_LINKS/);
    assert.match(healthSrc, /FOLDER_TAGS/);
  });

  it('should have error handling in fixFrontmatter', () => {
    assert.match(healthSrc, /try \{/, 'should have try block');
    assert.match(healthSrc, /SKIP frontmatter/, 'should skip on error');
  });

  it('should have error handling in fixOrphans', () => {
    assert.match(healthSrc, /SKIP orphan/, 'should skip orphans on error');
  });

  it('should skip files with existing frontmatter', () => {
    assert.match(healthSrc, /content\.startsWith\('---'\)/);
  });
});
