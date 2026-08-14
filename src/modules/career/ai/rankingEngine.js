const { MAX_ACTIVE_RECOMMENDATIONS } = require("../constants");
const { computeScore, bucketPriority } = require("./scoringEngine");

/**
 * Scores every candidate, sorts highest-first (confidence as tiebreaker),
 * and caps the list at MAX_ACTIVE_RECOMMENDATIONS. Pure function — no I/O,
 * no clock reads.
 *
 * @param {import("../types/career.types").CareerCandidate[]} candidates
 * @returns {Array}
 */
const rankAndScore = (candidates) => {
  const scored = candidates.map((candidate) => {
    const score = computeScore(candidate);
    return { ...candidate, score, priority: bucketPriority(score) };
  });

  scored.sort((a, b) => b.score - a.score || b.confidence - a.confidence);

  return scored.slice(0, MAX_ACTIVE_RECOMMENDATIONS);
};

module.exports = { rankAndScore };
