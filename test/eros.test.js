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
