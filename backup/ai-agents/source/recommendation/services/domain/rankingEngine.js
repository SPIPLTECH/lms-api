const { MAX_ACTIVE_RECOMMENDATIONS } = require("../../constants");
const { computeScore, bucketPriority } = require("./scoringEngine");

/**
 * Scores every candidate, sorts highest-first (confidence as tiebreaker),
 * and caps the list at MAX_ACTIVE_RECOMMENDATIONS. Pure function — no I/O,
 * no clock reads — everything time-sensitive (expiresAt) is decided by the
 * generators before candidates reach here.
 *
 * @param {import("../../types/recommendation.types").Candidate[]} candidates
 * @param {(type: string) => number} getAdjustmentMultiplier - per-type feedback multiplier lookup.
 * @returns {import("../../types/recommendation.types").ScoredCandidate[]}
 */
const rankAndScore = (candidates, getAdjustmentMultiplier = () => 1) => {
  const scored = candidates.map((candidate) => {
    const score = computeScore(candidate, getAdjustmentMultiplier(candidate.type));
    return { ...candidate, score, priority: bucketPriority(score) };
  });

  scored.sort((a, b) => b.score - a.score || b.confidence - a.confidence);

  return scored.slice(0, MAX_ACTIVE_RECOMMENDATIONS);
};

module.exports = { rankAndScore };
