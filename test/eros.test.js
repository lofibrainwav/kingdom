/**
 * EROS V6 Calculator Tests — deterministic math verification.
 * Port of HyoGook V6_EROS calculator with ±1e-6 precision.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  calculateEros,
  spiderWebToEros,
  routeDecision,
  calibrate,
  calibratedEros,
  objectiveEros,
  getProfile,
  interpretScore,
  calculateWithProfile,
  PROFILES,
  DEFAULT_WEIGHTS,
  PILLAR_ORDER,
  THRESHOLD_AUTO_RUN,
  THRESHOLD_ASK,
} = require('../agent/core/eros');

// Helper: check float equality within epsilon
function assertClose(actual, expected, epsilon = 1e-6, msg = '') {
  assert.equal(
    Math.abs(actual - expected) < epsilon, true,
    `${msg} expected ${expected}, got ${actual} (diff: ${Math.abs(actual - expected)})`
  );
}

describe('EROS V6 — calculateEros', () => {
  it('should compute correct S-score for perfect 10s', () => {
    const scores = { benevolence: 10, truth: 10, goodness: 10, beauty: 10, loyalty: 10, eternity: 10 };
    const result = calculateEros(scores);
    // S = exp(Σ w_i * log(10)) = exp(1 * log(10)) = 10
    assertClose(result.sScore, 10.0, 1e-6, 'perfect scores → S=10');
    assert.equal(result.decision, 'AUTO_RUN');
    assert.equal(result.zeroPillars.length, 0);
  });

  it('should return S=0 when any pillar is zero', () => {
    const scores = { benevolence: 10, truth: 0, goodness: 10, beauty: 10, loyalty: 10, eternity: 10 };
    const result = calculateEros(scores);
    assert.equal(result.sScore, 0);
    assert.equal(result.decision, 'BLOCK');
    assert.deepEqual(result.zeroPillars, ['truth']);
  });

  it('should match HyoGook V6 reference calculation', () => {
    // Reference: all pillars at 8.0
    // S = exp(0.28*log(8) + 0.28*log(8) + 0.22*log(8) + 0.15*log(8) + 0.05*log(8) + 0.02*log(8))
    // S = exp(1.0 * log(8)) = 8.0
    const scores = { benevolence: 8, truth: 8, goodness: 8, beauty: 8, loyalty: 8, eternity: 8 };
    const result = calculateEros(scores);
    assertClose(result.sScore, 8.0, 1e-6, 'uniform 8s → S=8');
    assert.equal(result.decision, 'BLOCK');
  });

  it('should compute correct S-score for mixed values', () => {
    // Manual calculation:
    // scores: [9, 9, 8, 7, 6, 5]
    // weights: [0.28, 0.28, 0.22, 0.15, 0.05, 0.02]
    // S = exp(0.28*ln(9) + 0.28*ln(9) + 0.22*ln(8) + 0.15*ln(7) + 0.05*ln(6) + 0.02*ln(5))
    const scores = { benevolence: 9, truth: 9, goodness: 8, beauty: 7, loyalty: 6, eternity: 5 };
    const expected = Math.exp(
      0.28 * Math.log(9) + 0.28 * Math.log(9) + 0.22 * Math.log(8) +
      0.15 * Math.log(7) + 0.05 * Math.log(6) + 0.02 * Math.log(5)
    );
    const result = calculateEros(scores);
    assertClose(result.sScore, expected, 1e-6, 'mixed values');
  });

  it('should compute fScore = avg + S * 0.4', () => {
    const scores = { benevolence: 10, truth: 10, goodness: 10, beauty: 10, loyalty: 10, eternity: 10 };
    const result = calculateEros(scores);
    // avg = 10, S = 10, fScore = 10 + 10*0.4 = 14
    assertClose(result.fScore, 14.0, 1e-6, 'fScore for perfect');
  });

  it('should clamp S-score to [0, 10]', () => {
    // Scores > 10 shouldn't produce S > 10 (but we enforce 0-10 range)
    const scores = { benevolence: 10, truth: 10, goodness: 10, beauty: 10, loyalty: 10, eternity: 10 };
    const result = calculateEros(scores);
    assert.equal(result.sScore <= 10, true, 'S should not exceed 10');
    assert.equal(result.sScore >= 0, true, 'S should not be negative');
  });

  it('should reject weights that do not sum to 1.0', () => {
    const scores = { benevolence: 5, truth: 5, goodness: 5, beauty: 5, loyalty: 5, eternity: 5 };
    const badWeights = { benevolence: 0.5, truth: 0.5, goodness: 0.5, beauty: 0.5, loyalty: 0.5, eternity: 0.5 };
    assert.throws(() => calculateEros(scores, badWeights), /sum to 1\.0/);
  });

  it('should include evidence bundle', () => {
    const scores = { benevolence: 7, truth: 7, goodness: 7, beauty: 7, loyalty: 7, eternity: 7 };
    const result = calculateEros(scores);
    assert.equal(result.evidence.version, 'v6');
    assert.equal(result.evidence.formula, 'S = exp(dot(weights, log(scores)))');
    assert.deepEqual(result.evidence.rawScores, scores);
    assert.equal(result.evidence.zeroPenaltyApplied, false);
  });

  it('should handle very small non-zero scores', () => {
    const scores = { benevolence: 0.01, truth: 0.01, goodness: 0.01, beauty: 0.01, loyalty: 0.01, eternity: 0.01 };
    const result = calculateEros(scores);
    assert.equal(result.sScore >= 0, true);
    assert.equal(result.decision, 'BLOCK');
  });
});

describe('EROS V6 — routeDecision', () => {
  it('should return AUTO_RUN for S >= 9.25', () => {
    assert.equal(routeDecision(9.25), 'AUTO_RUN');
    assert.equal(routeDecision(9.5), 'AUTO_RUN');
    assert.equal(routeDecision(10), 'AUTO_RUN');
  });

  it('should return ASK_COMMANDER for 8.6 <= S < 9.25', () => {
    assert.equal(routeDecision(8.6), 'ASK_COMMANDER');
    assert.equal(routeDecision(9.0), 'ASK_COMMANDER');
    assert.equal(routeDecision(9.24), 'ASK_COMMANDER');
  });

  it('should return BLOCK for S < 8.6', () => {
    assert.equal(routeDecision(8.59), 'BLOCK');
    assert.equal(routeDecision(0), 'BLOCK');
    assert.equal(routeDecision(5), 'BLOCK');
  });

  it('should match exact threshold boundaries', () => {
    assert.equal(routeDecision(THRESHOLD_AUTO_RUN), 'AUTO_RUN');
    assert.equal(routeDecision(THRESHOLD_ASK), 'ASK_COMMANDER');
    assert.equal(routeDecision(THRESHOLD_ASK - 0.001), 'BLOCK');
  });
});

describe('EROS V6 — spiderWebToEros', () => {
  it('should map perfect Spider Web (5,5,5) to EROS (10,10,10,10,10,10)', () => {
    const eros = spiderWebToEros({ truth: 5, goodness: 5, beauty: 5 });
    assert.equal(eros.benevolence, 10);
    assert.equal(eros.truth, 10);
    assert.equal(eros.goodness, 10);
    assert.equal(eros.beauty, 10);
    assert.equal(eros.loyalty, 10);
    assertClose(eros.eternity, 10.0 / 3 * 3, 1e-6); // (5+5+5)/3*2 = 10/3*... wait
  });

  it('should map minimum Spider Web (1,1,1) to EROS (2,2,2,2,2,2)', () => {
    const eros = spiderWebToEros({ truth: 1, goodness: 1, beauty: 1 });
    assert.equal(eros.benevolence, 2);
    assert.equal(eros.truth, 2);
    assert.equal(eros.goodness, 2);
    assert.equal(eros.beauty, 2);
    assert.equal(eros.loyalty, 2);
    assertClose(eros.eternity, 2.0, 1e-6);
  });

  it('should correctly compute derived pillars for asymmetric scores', () => {
    // truth=4, goodness=3, beauty=2
    const eros = spiderWebToEros({ truth: 4, goodness: 3, beauty: 2 });
    assert.equal(eros.truth, 8);       // 4*2
    assert.equal(eros.goodness, 6);    // 3*2
    assert.equal(eros.beauty, 4);      // 2*2
    assert.equal(eros.benevolence, 7); // (4+3)/2*2 = 7
    assert.equal(eros.loyalty, 6);     // (4+2)/2*2 = 6
    assertClose(eros.eternity, 6.0, 1e-6); // (4+3+2)/3*2 = 6
  });

  it('should produce AUTO_RUN when Spider Web is perfect', () => {
    const eros = spiderWebToEros({ truth: 5, goodness: 5, beauty: 5 });
    const result = calculateEros(eros);
    assertClose(result.sScore, 10.0, 1e-6);
    assert.equal(result.decision, 'AUTO_RUN');
  });

  it('should produce BLOCK when Spider Web is minimum', () => {
    const eros = spiderWebToEros({ truth: 1, goodness: 1, beauty: 1 });
    const result = calculateEros(eros);
    assertClose(result.sScore, 2.0, 1e-6);
    assert.equal(result.decision, 'BLOCK');
  });

  it('should produce correct decision for borderline scores', () => {
    // Spider Web 4.5 → all EROS pillars = 9.0 (uniform)
    // S = exp(1.0 * log(9)) = 9.0 → ASK_COMMANDER (8.6 ≤ 9.0 < 9.25)
    const eros = spiderWebToEros({ truth: 4.5, goodness: 4.5, beauty: 4.5 });
    const result = calculateEros(eros);
    assertClose(result.sScore, 9.0, 1e-6);
    assert.equal(result.decision, 'ASK_COMMANDER');
  });
});

describe('EROS V6 — constants and exports', () => {
  it('should export correct default weights summing to 1.0', () => {
    const sum = Object.values(DEFAULT_WEIGHTS).reduce((a, b) => a + b, 0);
    assertClose(sum, 1.0, 1e-9, 'weights sum');
  });

  it('should export correct pillar order', () => {
    assert.deepEqual(PILLAR_ORDER, ['benevolence', 'truth', 'goodness', 'beauty', 'loyalty', 'eternity']);
  });

  it('should export V6 thresholds matching HyoGook spec', () => {
    assert.equal(THRESHOLD_AUTO_RUN, 9.25);
    assert.equal(THRESHOLD_ASK, 8.6);
  });
});

// ── Calibration (Rolex-grade objective signal mixing) ─────────

describe('EROS V6 — calibrate', () => {
  const basePillars = { benevolence: 9, truth: 8, goodness: 10, beauty: 6, loyalty: 7, eternity: 8 };

  it('should return unmodified pillars with no signals', () => {
    const { pillars, confidence, adjustments } = calibrate(basePillars);
    assert.deepEqual(pillars, basePillars);
    assert.equal(confidence, 1.0); // all signals clean (defaults)
    assert.equal(adjustments.length, 0);
  });

  it('should penalize truth on retries', () => {
    const { pillars, adjustments } = calibrate(basePillars, { retryCount: 2 });
    assert.equal(pillars.truth, 8 - 3); // 2 * 1.5 = 3 penalty
    assert.equal(pillars.goodness, 10); // unaffected
    assert.equal(adjustments.length, 1);
    assert.ok(adjustments[0].includes('眞'));
  });

  it('should cap retry penalty at 4', () => {
    const { pillars } = calibrate(basePillars, { retryCount: 10 });
    assert.equal(pillars.truth, 8 - 4); // max penalty
  });

  it('should halve goodness on test failure', () => {
    const { pillars, adjustments } = calibrate(basePillars, { testsPassed: false });
    assert.equal(pillars.goodness, 5); // 10 * 0.5
    assert.ok(adjustments.some(a => a.includes('善')));
  });

  it('should penalize loyalty on high reject ratio', () => {
    const { pillars, adjustments } = calibrate(basePillars, { rejectRatio: 0.5 });
    assertClose(pillars.loyalty, 7 - 1.5, 1e-6); // 0.5 * 3
    assert.ok(adjustments.some(a => a.includes('忠')));
  });

  it('should not penalize loyalty on low reject ratio', () => {
    const { pillars } = calibrate(basePillars, { rejectRatio: 0.2 });
    assert.equal(pillars.loyalty, 7); // below 0.3 threshold
  });

  it('should penalize beauty on high file count', () => {
    const { pillars, adjustments } = calibrate(basePillars, { filesChanged: 20 });
    assertClose(pillars.beauty, 6 - 1.0, 1e-6); // (20-10)*0.1 = 1.0
    assert.ok(adjustments.some(a => a.includes('美')));
  });

  it('should calculate confidence correctly', () => {
    // All signals clean → 1.0
    const clean = calibrate(basePillars, { retryCount: 0, testsPassed: true, rejectRatio: 0, filesChanged: 5 });
    assert.equal(clean.confidence, 1.0);

    // All signals bad → 0.5
    const bad = calibrate(basePillars, { retryCount: 3, testsPassed: false, rejectRatio: 0.5, filesChanged: 20 });
    assert.equal(bad.confidence, 0.5);

    // 2 of 4 bad → 0.75
    const mixed = calibrate(basePillars, { retryCount: 2, testsPassed: true, rejectRatio: 0, filesChanged: 20 });
    assert.equal(mixed.confidence, 0.75);
  });

  it('should never produce negative pillar values', () => {
    const extreme = { benevolence: 1, truth: 1, goodness: 1, beauty: 1, loyalty: 1, eternity: 1 };
    const { pillars } = calibrate(extreme, { retryCount: 10, testsPassed: false, rejectRatio: 1.0, filesChanged: 50 });
    for (const p of Object.values(pillars)) {
      assert.equal(p > 0, true, `pillar should be > 0, got ${p}`);
    }
  });
});

describe('EROS V6 — calibratedEros (full pipeline)', () => {
  it('should produce higher S-score without penalties than with', () => {
    const clean = calibratedEros({ truth: 4, goodness: 5, beauty: 3 });
    const penalized = calibratedEros({ truth: 4, goodness: 5, beauty: 3 }, { retryCount: 2, testsPassed: false });
    assert.equal(clean.sScore > penalized.sScore, true, 'clean should score higher');
  });

  it('should downgrade decision on heavy penalties', () => {
    // Perfect spider web → normally AUTO_RUN
    const perfect = calibratedEros({ truth: 5, goodness: 5, beauty: 5 });
    assert.equal(perfect.decision, 'AUTO_RUN');

    // Same spider web but with failed tests + retries → should drop
    const penalized = calibratedEros({ truth: 5, goodness: 5, beauty: 5 }, { retryCount: 3, testsPassed: false });
    assert.equal(penalized.decision !== 'AUTO_RUN', true, 'should not auto-run with penalties');
  });

  it('should include calibration metadata', () => {
    const result = calibratedEros({ truth: 4, goodness: 3, beauty: 4 }, { retryCount: 1 });
    assert.ok(result.calibration);
    assert.equal(typeof result.calibration.confidence, 'number');
    assert.ok(Array.isArray(result.calibration.adjustments));
    assert.ok(result.calibration.rawPillars);
    assert.ok(result.calibration.calibratedPillars);
    assert.equal(result.calibration.signalsUsed, 1);
  });

  it('should report confidence=0.5 as LLM-only baseline', () => {
    // When ALL signals indicate problems
    const worst = calibratedEros(
      { truth: 5, goodness: 5, beauty: 5 },
      { retryCount: 5, testsPassed: false, rejectRatio: 0.8, filesChanged: 30 },
    );
    assert.equal(worst.calibration.confidence, 0.5);
  });

  it('should report confidence=1.0 when all evidence is clean', () => {
    const best = calibratedEros(
      { truth: 5, goodness: 5, beauty: 5 },
      { retryCount: 0, testsPassed: true, rejectRatio: 0, filesChanged: 3 },
    );
    assert.equal(best.calibration.confidence, 1.0);
  });
});

// ── objectiveEros (Pillar Metrics → EROS, no LLM) ───────────

describe('EROS V6 — objectiveEros', () => {
  it('should compute EROS from raw tool metrics', () => {
    const result = objectiveEros({
      truth: { syntaxErrors: 0, testPassRate: 1.0, testWeakPct: 5, testEmptyCount: 0 },
      goodness: { secretsFound: 0, auditCritical: 0, bareCatchCount: 2 },
      beauty: { longFiles: 1, consoleLogFiles: 3, testEmptyPct: 0 },
      benevolence: { avgFileLines: 120, errorClarityScore: 0.8, totalAgentFiles: 36 },
      loyalty: { deadEvents: 0, phantomListeners: 0, testFlakyRate: 0, dependencyDrift: 1 },
      eternity: { vaultOrphans: 1, missingFrontmatter: 0, memoryPresent: true, sessionLogRecent: true },
    });

    assert.ok(result.sScore > 0, 'sScore should be positive');
    assert.ok(result.decision, 'should have a decision');
    assert.ok(result.objective, 'should have objective metadata');
    assert.equal(result.objective.method, 'pillar-metrics');
    assert.equal(result.objective.confidence, 1.0);
  });

  it('should produce AUTO_RUN for perfect metrics', () => {
    const result = objectiveEros({
      truth: { syntaxErrors: 0, testPassRate: 1.0, testWeakPct: 0, testEmptyCount: 0 },
      goodness: { secretsFound: 0, auditCritical: 0, bareCatchCount: 0 },
      beauty: { longFiles: 0, consoleLogFiles: 0, testEmptyPct: 0 },
      benevolence: { avgFileLines: 100, errorClarityScore: 1.0, totalAgentFiles: 30 },
      loyalty: { deadEvents: 0, phantomListeners: 0, testFlakyRate: 0, dependencyDrift: 0 },
      eternity: { vaultOrphans: 0, missingFrontmatter: 0, memoryPresent: true, sessionLogRecent: true },
    });

    assertClose(result.sScore, 10, 1e-6, 'perfect objective sScore');
    assert.equal(result.decision, 'AUTO_RUN');
  });

  it('should BLOCK when secrets found', () => {
    const result = objectiveEros({
      truth: { syntaxErrors: 0, testPassRate: 1.0 },
      goodness: { secretsFound: 2 },
      beauty: {},
      benevolence: {},
      loyalty: {},
      eternity: { memoryPresent: false },
    });

    // Secrets drop goodness to 1, which drops S-score dramatically
    assert.ok(result.sScore < 8.6, `sScore should be <8.6 with secrets, got ${result.sScore}`);
  });

  it('should include pillar scores in objective metadata', () => {
    const result = objectiveEros({
      truth: { syntaxErrors: 1 },
      goodness: {},
    });
    assert.ok(result.objective.scores.truth < 10, 'truth should be penalized');
    assert.ok(result.objective.rawMetrics, 'should preserve raw metrics');
  });
});

// ── Interpretation Profiles (same clock, different timezone) ─

describe('EROS V6 — Interpretation Profiles', () => {
  const goodScores = { benevolence: 9, truth: 9, goodness: 9, beauty: 9, loyalty: 9, eternity: 9 };
  const borderlineScores = { benevolence: 9, truth: 9, goodness: 9, beauty: 8.5, loyalty: 8.5, eternity: 8.5 };

  it('all profiles have weights summing to 1.0', () => {
    for (const [name, profile] of Object.entries(PROFILES)) {
      const sum = Object.values(profile.weights).reduce((a, b) => a + b, 0);
      assertClose(sum, 1.0, 1e-6, `profile ${name} weights`);
    }
  });

  it('all profiles have required fields', () => {
    for (const [name, profile] of Object.entries(PROFILES)) {
      assert.ok(profile.name, `${name} should have name`);
      assert.ok(profile.weights, `${name} should have weights`);
      assert.ok(profile.thresholds, `${name} should have thresholds`);
      assert.equal(typeof profile.thresholds.autoRun, 'number', `${name} should have autoRun threshold`);
      assert.equal(typeof profile.thresholds.ask, 'number', `${name} should have ask threshold`);
      assert.ok(profile.thresholds.autoRun > profile.thresholds.ask, `${name}: autoRun should be > ask`);
    }
  });

  it('getProfile returns kingdom by default', () => {
    const profile = getProfile('kingdom');
    assert.equal(profile.name, 'Kingdom');
    assert.deepEqual(profile.weights, DEFAULT_WEIGHTS);
  });

  it('getProfile falls back to kingdom for unknown names', () => {
    const profile = getProfile('nonexistent');
    assert.equal(profile.name, 'Kingdom');
  });

  it('same score, different profile → different decision', () => {
    // borderline scores: ~8.8 S-score
    const result = calculateEros(borderlineScores);
    const sScore = result.sScore;

    const kingdom = interpretScore(sScore, 'kingdom');
    const relaxed = interpretScore(sScore, 'relaxed');
    const strict = interpretScore(sScore, 'strict');

    // Relaxed should be more permissive than kingdom, strict more restrictive
    assert.equal(relaxed.profile, 'Relaxed');
    assert.equal(strict.profile, 'Strict');
    assert.equal(kingdom.profile, 'Kingdom');

    // With S~8.8: kingdom=ASK, relaxed=AUTO_RUN (threshold 8.5), strict=BLOCK (threshold 9.0)
    assert.equal(kingdom.decision, 'ASK_COMMANDER');
    assert.equal(relaxed.decision, 'AUTO_RUN');
    assert.equal(strict.decision, 'BLOCK');
  });

  it('calculateWithProfile uses profile weights and thresholds', () => {
    const kingdom = calculateWithProfile(goodScores, 'kingdom');
    const strict = calculateWithProfile(goodScores, 'strict');

    assert.ok(kingdom.sScore > 0, 'kingdom sScore should be positive');
    assert.ok(strict.sScore > 0, 'strict sScore should be positive');
    assert.ok(kingdom.interpretation, 'should include interpretation metadata');
    assert.equal(kingdom.interpretation.profile, 'Kingdom');
    assert.equal(strict.interpretation.profile, 'Strict');
  });

  it('strict profile requires higher score for AUTO_RUN', () => {
    // Scores that pass kingdom but fail strict
    const scores = { benevolence: 9.3, truth: 9.3, goodness: 9.3, beauty: 9.3, loyalty: 9.3, eternity: 9.3 };
    const kingdom = calculateWithProfile(scores, 'kingdom');
    const strict = calculateWithProfile(scores, 'strict');

    assert.equal(kingdom.decision, 'AUTO_RUN');
    // strict has higher bar (9.5), same scores may not pass
    assert.ok(strict.interpretation.thresholds.autoRun > kingdom.interpretation.thresholds.autoRun);
  });

  it('aesthetic profile weighs beauty 30%', () => {
    const profile = getProfile('aesthetic');
    assert.equal(profile.weights.beauty, 0.30);
    assert.ok(profile.weights.beauty > DEFAULT_WEIGHTS.beauty, 'aesthetic beauty > kingdom beauty');
  });
});
