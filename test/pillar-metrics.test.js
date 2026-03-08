const assert = require('node:assert');
const { describe, it } = require('node:test');

const {
  fromRawMetrics,
  clampScore,
  scoreTruth,
  scoreGoodness,
  scoreBeauty,
  scoreBenevolence,
  scoreLoyalty,
  scoreEternity,
} = require('../agent/core/pillar-metrics');

// ── clampScore ───────────────────────────────────────────────

describe('clampScore', () => {
  it('clamps negative to 1', () => {
    assert.strictEqual(clampScore(-5), 1);
  });

  it('clamps over 10 to 10', () => {
    assert.strictEqual(clampScore(15), 10);
  });

  it('rounds to 1 decimal', () => {
    assert.strictEqual(clampScore(7.777), 7.8);
  });

  it('preserves exact values', () => {
    assert.strictEqual(clampScore(5), 5);
    assert.strictEqual(clampScore(10), 10);
    assert.strictEqual(clampScore(1), 1);
  });
});

// ── scoreTruth ───────────────────────────────────────────────

describe('scoreTruth', () => {
  it('perfect metrics = 10', () => {
    const score = scoreTruth({
      syntaxErrors: 0, testPassRate: 1.0, testWeakPct: 0, testEmptyCount: 0,
    });
    assert.strictEqual(score, 10);
  });

  it('syntax errors penalize heavily', () => {
    const score = scoreTruth({ syntaxErrors: 3, testPassRate: 1.0 });
    assert.ok(score >= 3.5 && score <= 4.5, `syntaxErrors=3: expected ~4, got ${score}`);
  });

  it('test failure penalizes truth', () => {
    const score = scoreTruth({ syntaxErrors: 0, testPassRate: 0.8 });
    assert.ok(score >= 8.5 && score <= 9.5, `testPassRate=0.8: expected ~9, got ${score}`);
  });

  it('combined penalties stack', () => {
    const score = scoreTruth({
      syntaxErrors: 1, testPassRate: 0.9, testWeakPct: 20, testEmptyCount: 2,
    });
    assert.ok(score < 8, `combined should be <8, got ${score}`);
    assert.ok(score >= 1, `score should be >=1, got ${score}`);
  });

  it('defaults to perfect when empty', () => {
    assert.strictEqual(scoreTruth({}), 10);
  });
});

// ── scoreGoodness ────────────────────────────────────────────

describe('scoreGoodness', () => {
  it('no security issues = 10', () => {
    assert.strictEqual(scoreGoodness({ secretsFound: 0, auditCritical: 0, bareCatchCount: 0 }), 10);
  });

  it('secrets found is catastrophic', () => {
    const score = scoreGoodness({ secretsFound: 1 });
    assert.strictEqual(score, 5);
  });

  it('audit critical vulnerabilities penalize', () => {
    const score = scoreGoodness({ auditCritical: 2 });
    assert.strictEqual(score, 4);
  });

  it('bare catch is minor penalty', () => {
    const score = scoreGoodness({ bareCatchCount: 4 });
    assert.strictEqual(score, 8);
  });

  it('floor at 1 even with many issues', () => {
    const score = scoreGoodness({ secretsFound: 5, auditCritical: 5, bareCatchCount: 20 });
    assert.strictEqual(score, 1);
  });
});

// ── scoreBeauty ──────────────────────────────────────────────

describe('scoreBeauty', () => {
  it('clean codebase = 10', () => {
    assert.strictEqual(scoreBeauty({ longFiles: 0, consoleLogFiles: 0, testEmptyPct: 0 }), 10);
  });

  it('long files penalize', () => {
    const score = scoreBeauty({ longFiles: 5 });
    assert.strictEqual(score, 7.5);
  });

  it('console.log in agent code penalizes', () => {
    const score = scoreBeauty({ consoleLogFiles: 10 });
    assert.strictEqual(score, 7);
  });

  it('combined beauty penalties', () => {
    const score = scoreBeauty({ longFiles: 4, consoleLogFiles: 6, testEmptyPct: 10 });
    assert.ok(score < 8, `combined should be <8, got ${score}`);
    assert.ok(score >= 1, `score floor check, got ${score}`);
  });
});

// ── scoreBenevolence ─────────────────────────────────────────

describe('scoreBenevolence', () => {
  it('small readable files = 10', () => {
    assert.strictEqual(scoreBenevolence({ avgFileLines: 100, errorClarityScore: 1.0, totalAgentFiles: 30 }), 10);
  });

  it('large files reduce benevolence', () => {
    const score = scoreBenevolence({ avgFileLines: 300, errorClarityScore: 1.0, totalAgentFiles: 30 });
    assert.strictEqual(score, 8.5);
  });

  it('unclear error messages penalize', () => {
    const score = scoreBenevolence({ avgFileLines: 100, errorClarityScore: 0.3, totalAgentFiles: 30 });
    assert.strictEqual(score, 7.9);
  });

  it('too many files increases complexity', () => {
    const score = scoreBenevolence({ avgFileLines: 100, errorClarityScore: 1.0, totalAgentFiles: 60 });
    assert.strictEqual(score, 8);
  });
});

// ── scoreLoyalty ──────────────────────────────────────────────

describe('scoreLoyalty', () => {
  it('zero drift = 10', () => {
    assert.strictEqual(scoreLoyalty({
      deadEvents: 0, phantomListeners: 0, testFlakyRate: 0, dependencyDrift: 0,
    }), 10);
  });

  it('phantom listeners penalize heavily', () => {
    const score = scoreLoyalty({ phantomListeners: 3 });
    assert.strictEqual(score, 4);
  });

  it('dead events penalize moderately', () => {
    const score = scoreLoyalty({ deadEvents: 2 });
    assert.strictEqual(score, 8);
  });

  it('dependency drift is minor', () => {
    const score = scoreLoyalty({ dependencyDrift: 5 });
    assert.strictEqual(score, 8.5);
  });
});

// ── scoreEternity ────────────────────────────────────────────

describe('scoreEternity', () => {
  it('healthy vault = 10', () => {
    assert.strictEqual(scoreEternity({
      vaultOrphans: 0, missingFrontmatter: 0, memoryPresent: true, sessionLogRecent: true,
    }), 10);
  });

  it('orphans and missing frontmatter penalize', () => {
    const score = scoreEternity({ vaultOrphans: 5, missingFrontmatter: 3, memoryPresent: true, sessionLogRecent: true });
    assert.strictEqual(score, 7.6);
  });

  it('missing memory is a penalty', () => {
    const score = scoreEternity({ vaultOrphans: 0, missingFrontmatter: 0, memoryPresent: false, sessionLogRecent: true });
    assert.strictEqual(score, 8);
  });

  it('stale session log penalizes', () => {
    const score = scoreEternity({ vaultOrphans: 0, missingFrontmatter: 0, memoryPresent: true, sessionLogRecent: false });
    assert.strictEqual(score, 9);
  });
});

// ── fromRawMetrics (integration) ─────────────────────────────

describe('fromRawMetrics', () => {
  it('perfect metrics yield all 10s', () => {
    const { scores } = fromRawMetrics({
      truth: { syntaxErrors: 0, testPassRate: 1.0, testWeakPct: 0, testEmptyCount: 0 },
      goodness: { secretsFound: 0, auditCritical: 0, bareCatchCount: 0 },
      beauty: { longFiles: 0, consoleLogFiles: 0, testEmptyPct: 0 },
      benevolence: { avgFileLines: 100, errorClarityScore: 1.0, totalAgentFiles: 30 },
      loyalty: { deadEvents: 0, phantomListeners: 0, testFlakyRate: 0, dependencyDrift: 0 },
      eternity: { vaultOrphans: 0, missingFrontmatter: 0, memoryPresent: true, sessionLogRecent: true },
    });
    for (const [pillar, score] of Object.entries(scores)) {
      assert.strictEqual(score, 10, `${pillar} should be 10`);
    }
  });

  it('returns all 6 pillars', () => {
    const { scores } = fromRawMetrics({});
    const pillars = Object.keys(scores);
    assert.deepStrictEqual(pillars.sort(), [
      'beauty', 'benevolence', 'eternity', 'goodness', 'loyalty', 'truth',
    ]);
  });

  it('defaults to high scores when no metrics provided', () => {
    const { scores } = fromRawMetrics({});
    assert.strictEqual(scores.truth, 10);
    assert.strictEqual(scores.goodness, 10);
    assert.strictEqual(scores.beauty, 10);
  });

  it('preserves raw metrics in output', () => {
    const raw = { truth: { syntaxErrors: 1 }, goodness: { secretsFound: 2 } };
    const result = fromRawMetrics(raw);
    assert.deepStrictEqual(result.raw, raw);
  });

  it('realistic Kingdom snapshot scores correctly', () => {
    const { scores } = fromRawMetrics({
      truth: { syntaxErrors: 0, testPassRate: 1.0, testWeakPct: 8, testEmptyCount: 0 },
      goodness: { secretsFound: 0, auditCritical: 0, bareCatchCount: 3 },
      beauty: { longFiles: 2, consoleLogFiles: 5, testEmptyPct: 2 },
      benevolence: { avgFileLines: 140, errorClarityScore: 0.7, totalAgentFiles: 36 },
      loyalty: { deadEvents: 0, phantomListeners: 0, testFlakyRate: 0, dependencyDrift: 2 },
      eternity: { vaultOrphans: 2, missingFrontmatter: 1, memoryPresent: true, sessionLogRecent: true },
    });
    for (const [pillar, score] of Object.entries(scores)) {
      assert.ok(score >= 7, `${pillar} should be >=7, got ${score}`);
    }
    assert.ok(scores.truth >= 9, `truth should be >=9, got ${scores.truth}`);
  });
});
