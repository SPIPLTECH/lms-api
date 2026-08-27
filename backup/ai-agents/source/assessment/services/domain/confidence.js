const { CONFIDENCE_SAMPLE_SCALE } = require("../../constants");
const { clamp, round2, stdDev } = require("../../utils/scoreMath.util");

/**
 * Confidence = "how sure are we this mastery score is right", separate
 * from the score itself. Grows with sample size (asymptotically — more
 * attempts always helps, with diminishing returns) and is capped lower
 * when recent scores are inconsistent (lots of erratic data is still
 * uncertain, even if plentiful).
 *
 * @param {number} attemptsCount
 * @param {number[]} recentScores
 * @returns {number} 0-100
 */
const computeConfidence = (attemptsCount, recentScores) => {
  if (attemptsCount <= 0) return 0;

  const sampleFactor = attemptsCount / (attemptsCount + CONFIDENCE_SAMPLE_SCALE);

  if (recentScores.length < 2) {
    return round2(clamp(sampleFactor * 100, 0, 100));
  }

  // stdDev up to 50 points maps consistencyFactor from 1 down to 0.
  const consistencyFactor = clamp(1 - stdDev(recentScores) / 50, 0, 1);
  const ceiling = 50 + 50 * consistencyFactor; // 50-100 range based on consistency
  return round2(clamp(sampleFactor * ceiling, 0, 100));
};

module.exports = { computeConfidence };
