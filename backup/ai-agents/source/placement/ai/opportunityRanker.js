const {
  RANKING_MATCH_WEIGHT,
  RANKING_URGENCY_WEIGHT,
  DEADLINE_URGENCY_WINDOW_DAYS,
  MATCH_PRIORITY_HIGH_THRESHOLD,
  MATCH_PRIORITY_MEDIUM_THRESHOLD,
  TOP_MATCHES_COUNT,
  JOB_MATCH_PRIORITY,
} = require("../constants");
const { clamp } = require("../utils/scoreMath.util");

/** No deadline -> a mild baseline urgency (still worth acting on, but no real time pressure); a passed deadline floors to 0 as a defensive guard (callers should already filter to OPEN opportunities). */
const computeUrgency = (deadline, now) => {
  if (!deadline) return 30;
  const daysRemaining = (new Date(deadline).getTime() - now.getTime()) / (24 * 3600 * 1000);
  if (daysRemaining <= 0) return 0;
  return clamp(100 - (daysRemaining / DEADLINE_URGENCY_WINDOW_DAYS) * 100);
};

const bucketPriority = (matchPercent) => {
  if (matchPercent >= MATCH_PRIORITY_HIGH_THRESHOLD) return JOB_MATCH_PRIORITY.HIGH;
  if (matchPercent >= MATCH_PRIORITY_MEDIUM_THRESHOLD) return JOB_MATCH_PRIORITY.MEDIUM;
  return JOB_MATCH_PRIORITY.LOW;
};

/**
 * Ranks match candidates by a blend of skill match % and application-
 * deadline urgency, then caps the list — same "score, sort, cap" shape as
 * every other recommendation-producing agent in this series. Priority is
 * bucketed from matchPercent alone (how good a fit), while the ranking
 * score additionally factors in urgency (how soon it closes) — a strong
 * fit with a looming deadline should surface above an equally strong fit
 * with months left.
 *
 * @param {{opportunity: Object, matchPercent: number, missingSkills: string[]}[]} candidates
 * @param {Date} now
 * @returns {Array} ranked, capped, each with score/priority attached
 */
const rankOpportunities = (candidates, now) => {
  const scored = candidates.map((candidate) => {
    const urgency = computeUrgency(candidate.opportunity.applicationDeadline, now);
    const score = Math.round(clamp(candidate.matchPercent * RANKING_MATCH_WEIGHT + urgency * RANKING_URGENCY_WEIGHT));
    return { ...candidate, score, priority: bucketPriority(candidate.matchPercent) };
  });

  scored.sort((a, b) => b.score - a.score || b.matchPercent - a.matchPercent);

  return scored.slice(0, TOP_MATCHES_COUNT);
};

module.exports = { rankOpportunities, computeUrgency, bucketPriority };
