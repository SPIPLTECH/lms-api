const { TRENDS, ENGAGEMENT_TREND_DELTA_POINTS } = require("../../constants");

/**
 * Compares the mean of the newer half of a chronological (oldest-first)
 * window of EngagementTrend scores against the older half. Needs at least
 * 2 points to say anything other than STABLE. Same approach as Assessment's
 * concept-mastery trend — kept as its own copy per this codebase's
 * per-agent convention.
 *
 * @param {number[]} scoresOldestFirst
 */
const computeTrend = (scoresOldestFirst) => {
  if (scoresOldestFirst.length < 2) return TRENDS.STABLE;

  const mid = Math.floor(scoresOldestFirst.length / 2);
  const older = scoresOldestFirst.slice(0, mid);
  const newer = scoresOldestFirst.slice(mid);

  const olderAvg = older.reduce((a, b) => a + b, 0) / older.length;
  const newerAvg = newer.reduce((a, b) => a + b, 0) / newer.length;
  const delta = newerAvg - olderAvg;

  if (delta >= ENGAGEMENT_TREND_DELTA_POINTS) return TRENDS.IMPROVING;
  if (delta <= -ENGAGEMENT_TREND_DELTA_POINTS) return TRENDS.DECLINING;
  return TRENDS.STABLE;
};

module.exports = { computeTrend };
