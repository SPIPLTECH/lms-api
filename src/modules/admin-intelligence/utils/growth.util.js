const { percentChange } = require("./scoreMath.util");

const DAY_MS = 24 * 3600 * 1000;

/**
 * % change in enrollment count between the prior `windowDays` window and the
 * most recent `windowDays` window, from a plain list of {enrolledAt} rows.
 * Own real computation — this specific "growth" framing isn't a metric
 * Analytics already owns, unlike REVENUE_READY/RETENTION/CHURN/AI_USAGE
 * which are reused as-is via analytics.getPlatformKPIs().
 *
 * @param {{enrolledAt: Date}[]} enrollments
 * @param {Date} now
 * @param {number} [windowDays]
 */
const computeEnrollmentGrowthPercent = (enrollments, now, windowDays = 30) => {
  const windowMs = windowDays * DAY_MS;
  const recentStart = now.getTime() - windowMs;
  const priorStart = recentStart - windowMs;

  let recentCount = 0;
  let priorCount = 0;

  for (const { enrolledAt } of enrollments) {
    const t = new Date(enrolledAt).getTime();
    if (t >= recentStart && t <= now.getTime()) recentCount += 1;
    else if (t >= priorStart && t < recentStart) priorCount += 1;
  }

  return percentChange(priorCount, recentCount);
};

/** Buckets a list of {date} rows into one count per calendar day, for regression input. */
const bucketByDay = (rows, dateField, sinceDate, now) => {
  const buckets = new Map();
  for (const row of rows) {
    const t = new Date(row[dateField]);
    if (t < sinceDate || t > now) continue;
    const dayKey = t.toISOString().slice(0, 10);
    buckets.set(dayKey, (buckets.get(dayKey) || 0) + 1);
  }
  return [...buckets.entries()].map(([date, value]) => ({ date, value })).sort((a, b) => (a.date < b.date ? -1 : 1));
};

module.exports = { computeEnrollmentGrowthPercent, bucketByDay };
