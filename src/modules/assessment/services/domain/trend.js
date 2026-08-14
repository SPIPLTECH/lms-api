const { TRENDS, IMPROVEMENT_TREND_DELTA_POINTS } = require("../../constants");

/**
 * Compares the mean of the newer half of a bounded recent-scores window
 * against the older half. Needs at least 2 points to say anything other
 * than STABLE. Same approach as the Student State Agent's performance
 * trend — kept as its own copy per this codebase's per-agent convention.
 */
const computeTrend = (recentScores) => {
  if (recentScores.length < 2) return TRENDS.STABLE;

  const mid = Math.floor(recentScores.length / 2);
  const older = recentScores.slice(0, mid);
  const newer = recentScores.slice(mid);

  const olderAvg = older.reduce((a, b) => a + b, 0) / older.length;
  const newerAvg = newer.reduce((a, b) => a + b, 0) / newer.length;
  const delta = newerAvg - olderAvg;

  if (delta >= IMPROVEMENT_TREND_DELTA_POINTS) return TRENDS.IMPROVING;
  if (delta <= -IMPROVEMENT_TREND_DELTA_POINTS) return TRENDS.DECLINING;
  return TRENDS.STABLE;
};

module.exports = { computeTrend };
