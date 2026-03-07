/**
 * EROS V6 Calculator — Kingdom Port of HyoGook V6_EROS
 *
 * Pure math engine. No prompt changes. Phase 1 only.
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

module.exports = {
  calculateEros,
  spiderWebToEros,
  routeDecision,
  DEFAULT_WEIGHTS,
  PILLAR_ORDER,
  THRESHOLD_AUTO_RUN,
  THRESHOLD_ASK,
};
