/**
 * EROS V6 Calculator — Kingdom Port of HyoGook V6_EROS
 *
 * Rolex-grade scoring: LLM judgment + objective signal calibration.
 *
 * 6-virtue weighted geometric mean:
 *   S = exp(Σ w_i · log(score_i))
 *
 * Weights: 仁28% 眞28% 善22% 美15% 忠5% 永2%
 * Thresholds: S ≥ 9.25 → AUTO_RUN, S ≥ 8.6 → ASK_COMMANDER, else BLOCK
 *
 * Spider Web (3-axis, 1-5) → EROS (6-axis, 0-10) mapping:
 *   benevolence = (truth + goodness) / 2 * 2
 *   truth       = truth * 2
 *   goodness    = goodness * 2
 *   beauty      = beauty * 2
 *   loyalty     = (truth + beauty) / 2 * 2
 *   eternity    = (truth + goodness + beauty) / 3 * 2
 *
 * Calibration layer (objective signals):
 *   - retryCount: penalizes 眞(truth) — wasn't right first time
 *   - testsPassed: penalizes 善(goodness) if false — safety risk
 *   - rejectRatio: penalizes 忠(loyalty) — unreliable track record
 *   - confidence: how much of the score is grounded in evidence (0-1)
 */

const PILLAR_ORDER = ['benevolence', 'truth', 'goodness', 'beauty', 'loyalty', 'eternity'];

const DEFAULT_WEIGHTS = {
  benevolence: 0.28,
  truth: 0.28,
  goodness: 0.22,
  beauty: 0.15,
  loyalty: 0.05,
  eternity: 0.02,
};

const THRESHOLD_AUTO_RUN = 9.25;
const THRESHOLD_ASK = 8.6;
const FLOOR = 0.01; // Prevent log(0)

/**
 * Interpretation Profiles — Same clock, different timezones.
 *
 * The EROS calculator (clock mechanism) is identical everywhere.
 * But S=8.7 means different things in different contexts:
 *   - Kingdom internal → ASK_COMMANDER (our bar is high)
 *   - Open source project → AUTO_RUN (world standard is lower)
 *   - Mission-critical → BLOCK (NASA-grade strictness)
 *
 * Each profile defines: weights + thresholds + name.
 * The clock stays the same — only the interpretation changes.
 */
const PROFILES = {
  // Kingdom default — our internal standard
  kingdom: {
    name: 'Kingdom',
    weights: DEFAULT_WEIGHTS,
    thresholds: { autoRun: 9.25, ask: 8.6 },
    description: 'Kingdom internal governance standard',
  },
  // Strict mode — for security-sensitive or production-critical work
  strict: {
    name: 'Strict',
    weights: {
      benevolence: 0.20,
      truth: 0.30,
      goodness: 0.30,
      beauty: 0.10,
      loyalty: 0.08,
      eternity: 0.02,
    },
    thresholds: { autoRun: 9.5, ask: 9.0 },
    description: 'Mission-critical: higher truth+goodness weight, tighter thresholds',
  },
  // Relaxed — for experimental or prototype work
  relaxed: {
    name: 'Relaxed',
    weights: {
      benevolence: 0.25,
      truth: 0.25,
      goodness: 0.20,
      beauty: 0.20,
      loyalty: 0.05,
      eternity: 0.05,
    },
    thresholds: { autoRun: 8.5, ask: 7.5 },
    description: 'Experimental: more beauty/eternity weight, looser thresholds',
  },
  // Beauty-first — for UI/UX or design-heavy projects
  aesthetic: {
    name: 'Aesthetic',
    weights: {
      benevolence: 0.20,
      truth: 0.20,
      goodness: 0.15,
      beauty: 0.30,
      loyalty: 0.05,
      eternity: 0.10,
    },
    thresholds: { autoRun: 9.0, ask: 8.0 },
    description: 'Design-focused: beauty is primary virtue',
  },
};

/**
 * Get an interpretation profile by name.
 * @param {string} name — profile name (kingdom, strict, relaxed, aesthetic)
 * @returns {Object} profile with weights, thresholds, name, description
 */
function getProfile(name) {
  return PROFILES[name] || PROFILES.kingdom;
}

/**
 * Interpret an S-score using a named profile's thresholds.
 * Same score, different timezone → different decision.
 * @param {number} sScore — the raw S-score from calculateEros
 * @param {string} [profileName='kingdom'] — interpretation profile
 * @returns {{ decision: string, profile: string, thresholds: Object }}
 */
function interpretScore(sScore, profileName = 'kingdom') {
  const profile = getProfile(profileName);
  const { autoRun, ask } = profile.thresholds;
  let decision;
  if (sScore >= autoRun) decision = 'AUTO_RUN';
  else if (sScore >= ask) decision = 'ASK_COMMANDER';
  else decision = 'BLOCK';

  return {
    decision,
    profile: profile.name,
    thresholds: profile.thresholds,
  };
}

/**
 * Calculate EROS using a specific interpretation profile.
 * @param {Object} scores — 6-pillar scores (0-10)
 * @param {string} [profileName='kingdom'] — profile name
 * @returns {Object} — EROS result with profile-aware routing
 */
function calculateWithProfile(scores, profileName = 'kingdom') {
  const profile = getProfile(profileName);
  const result = calculateEros(scores, profile.weights);
  const interpretation = interpretScore(result.sScore, profileName);
  return {
    ...result,
    decision: interpretation.decision,
    interpretation,
  };
}

/**
 * Calculate EROS V6 S-score from 6 pillar scores.
 * @param {Object} scores — { benevolence, truth, goodness, beauty, loyalty, eternity } each 0-10
 * @param {Object} [weights] — custom weights (must sum to 1.0)
 * @returns {{ sScore: number, fScore: number, decision: string, zeroPillars: string[], evidence: Object }}
 */
function calculateEros(scores, weights = DEFAULT_WEIGHTS) {
  const scoreArr = PILLAR_ORDER.map(p => scores[p] ?? 0);
  const weightArr = PILLAR_ORDER.map(p => weights[p]);

  // Validate weights sum to ~1.0
  const weightSum = weightArr.reduce((a, b) => a + b, 0);
  if (Math.abs(weightSum - 1.0) > 1e-6) {
    throw new Error(`Weights must sum to 1.0, got ${weightSum}`);
  }

  // Detect zero pillars
  const zeroPillars = PILLAR_ORDER.filter((p, i) => scoreArr[i] === 0);

  // S = exp(Σ w_i · log(score_i)), or 0 if any pillar is zero
  let sScore;
  if (zeroPillars.length > 0) {
    sScore = 0;
  } else {
    const logSum = weightArr.reduce((sum, w, i) => {
      return sum + w * Math.log(Math.max(scoreArr[i], FLOOR));
    }, 0);
    sScore = Math.exp(logSum);
  }

  // Clamp to [0, 10]
  sScore = Math.min(10, Math.max(0, sScore));

  // F_display = avg + S * 0.4
  const avg = scoreArr.reduce((a, b) => a + b, 0) / scoreArr.length;
  const fScore = avg + sScore * 0.4;

  const decision = routeDecision(sScore);

  return {
    sScore,
    fScore,
    decision,
    zeroPillars,
    evidence: {
      formula: 'S = exp(dot(weights, log(scores)))',
      version: 'v6',
      zeroPenaltyApplied: zeroPillars.length > 0,
      weights,
      rawScores: scores,
    },
  };
}

/**
 * Map 3-axis Spider Web scores (1-5) to 6-pillar EROS scores (0-10).
 * @param {{ truth: number, goodness: number, beauty: number }} spiderWeb
 * @returns {{ benevolence: number, truth: number, goodness: number, beauty: number, loyalty: number, eternity: number }}
 */
function spiderWebToEros(spiderWeb) {
  const t = spiderWeb.truth;
  const g = spiderWeb.goodness;
  const b = spiderWeb.beauty;

  return {
    benevolence: ((t + g) / 2) * 2,
    truth: t * 2,
    goodness: g * 2,
    beauty: b * 2,
    loyalty: ((t + b) / 2) * 2,
    eternity: ((t + g + b) / 3) * 2,
  };
}

/**
 * Route decision based on S-score thresholds.
 * @param {number} sScore
 * @returns {'AUTO_RUN' | 'ASK_COMMANDER' | 'BLOCK'}
 */
function routeDecision(sScore) {
  if (sScore >= THRESHOLD_AUTO_RUN) return 'AUTO_RUN';
  if (sScore >= THRESHOLD_ASK) return 'ASK_COMMANDER';
  return 'BLOCK';
}

/**
 * Calibrate EROS pillars with objective signals.
 * Adjusts LLM-derived scores based on measurable evidence.
 *
 * @param {Object} pillars — 6-pillar EROS scores (0-10)
 * @param {Object} signals — objective evidence
 * @param {number} [signals.retryCount=0] — how many times this batch was rejected before
 * @param {boolean} [signals.testsPassed=true] — did all tests pass?
 * @param {number} [signals.rejectRatio=0] — historical reject ratio for this project (0-1)
 * @param {number} [signals.filesChanged=0] — number of files in batch (complexity proxy)
 * @returns {{ pillars: Object, confidence: number, adjustments: string[] }}
 */
function calibrate(pillars, signals = {}) {
  const retryCount = signals.retryCount || 0;
  const testsPassed = signals.testsPassed !== false; // default true
  const rejectRatio = signals.rejectRatio || 0;
  const filesChanged = signals.filesChanged || 0;

  const adjusted = { ...pillars };
  const adjustments = [];
  let evidencePoints = 0;
  let totalSignals = 0;

  // Signal 1: Retry count penalizes 眞(truth) — it wasn't correct first time
  totalSignals++;
  if (retryCount > 0) {
    const penalty = Math.min(retryCount * 1.5, 4); // max -4 from 10
    adjusted.truth = Math.max(FLOOR, adjusted.truth - penalty);
    adjustments.push(`眞-${penalty.toFixed(1)} (${retryCount} retries)`);
  } else {
    evidencePoints++;
  }

  // Signal 2: Test failure penalizes 善(goodness) — safety concern
  totalSignals++;
  if (!testsPassed) {
    adjusted.goodness = Math.max(FLOOR, adjusted.goodness * 0.5);
    adjustments.push(`善×0.5 (tests failed)`);
  } else {
    evidencePoints++;
  }

  // Signal 3: Historical reject ratio penalizes 忠(loyalty) — unreliable track record
  totalSignals++;
  if (rejectRatio > 0.3) {
    const penalty = rejectRatio * 3; // 30% reject → -0.9, 50% → -1.5
    adjusted.loyalty = Math.max(FLOOR, adjusted.loyalty - penalty);
    adjustments.push(`忠-${penalty.toFixed(1)} (${(rejectRatio * 100).toFixed(0)}% reject history)`);
  } else {
    evidencePoints++;
  }

  // Signal 4: High complexity slightly penalizes 美(beauty) — harder to be clean
  totalSignals++;
  if (filesChanged > 10) {
    const penalty = Math.min((filesChanged - 10) * 0.1, 2); // max -2
    adjusted.beauty = Math.max(FLOOR, adjusted.beauty - penalty);
    adjustments.push(`美-${penalty.toFixed(1)} (${filesChanged} files)`);
  } else {
    evidencePoints++;
  }

  // Confidence: ratio of evidence-backed signals
  // 0 signals checked = 0.5 (LLM-only baseline)
  // All signals clean = 1.0 (fully evidence-backed)
  const confidence = totalSignals > 0
    ? 0.5 + 0.5 * (evidencePoints / totalSignals)
    : 0.5;

  return { pillars: adjusted, confidence, adjustments };
}

/**
 * Full calibrated EROS pipeline: Spider Web → calibrate → calculate.
 * This is the Rolex-grade entry point.
 *
 * @param {Object} spiderWeb — { truth, goodness, beauty } each 1-5
 * @param {Object} [signals] — objective calibration signals
 * @returns {Object} — full EROS result with calibration metadata
 */
function calibratedEros(spiderWeb, signals = {}) {
  const rawPillars = spiderWebToEros(spiderWeb);
  const { pillars, confidence, adjustments } = calibrate(rawPillars, signals);
  const result = calculateEros(pillars);

  return {
    ...result,
    calibration: {
      confidence,
      adjustments,
      rawPillars,
      calibratedPillars: pillars,
      signalsUsed: Object.keys(signals).filter(k => signals[k] !== undefined).length,
    },
  };
}

/**
 * Full objective EROS pipeline: Pillar Metrics → calculate.
 * Bypasses LLM opinion entirely — scores derived from tool output.
 *
 * @param {Object} rawMetrics — { truth, goodness, beauty, benevolence, loyalty, eternity }
 *   Each key contains tool-measured values (see pillar-metrics.js for schema).
 * @returns {Object} — EROS result with objective measurement metadata
 */
function objectiveEros(rawMetrics) {
  const { fromRawMetrics } = require('./pillar-metrics');
  const { scores, raw } = fromRawMetrics(rawMetrics);
  const result = calculateEros(scores);

  return {
    ...result,
    objective: {
      method: 'pillar-metrics',
      scores,
      rawMetrics: raw,
      confidence: 1.0, // fully evidence-backed, no LLM opinion
    },
  };
}

module.exports = {
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
};
