const prisma = require("../../config/database");
const engine = require("./adminIntelligence.engine");
const analytics = require("../analytics");

/**
 * Admin Intelligence agent — adaptive Phase 6. ADMIN-only.
 *
 * Computed on read from Analytics' getters (the original sat one layer above
 * Analytics in exactly this way). It keeps no tables of its own: the history
 * it needs — "active learners a week ago" — is Analytics' snapshots.
 */

async function getDashboard({ now = new Date() } = {}) {
  await analytics.ensureToday(now);

  const [platform, courses, platformTrend] = await Promise.all([
    analytics.getPlatformKPIs(),
    analytics.getCourseKPIsBatch(),
    analytics.getSnapshots("PLATFORM", analytics.PLATFORM_SCOPE_ID, { days: 8, now }),
  ]);

  const creatorIds = [...new Set(courses.map((c) => c.creatorId).filter(Boolean))];
  const instructors = creatorIds.length
    ? await prisma.user.findMany({ where: { id: { in: creatorIds } }, select: { id: true, name: true } })
    : [];

  // The snapshot closest to 7 days ago (the oldest of the last 8 days).
  const previous = platformTrend.length > 1 ? platformTrend[0].metrics : null;

  return {
    ...engine.buildDashboard({
      platform,
      previousPlatform: previous,
      courses,
      instructorNames: new Map(instructors.map((u) => [u.id, u.name])),
      now,
    }),
    computedAt: now,
  };
}

module.exports = { getDashboard };
