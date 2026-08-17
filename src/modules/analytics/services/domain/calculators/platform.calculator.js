const prisma = require("../../../../../config/database");

const {
  METRIC_KEY,
  DAU_WINDOW_DAYS,
  WEEKLY_ACTIVE_WINDOW_DAYS,
  MAU_WINDOW_DAYS,
  AI_USAGE_WINDOW_DAYS,
  RETENTION_WINDOW_DAYS,
} = require("../../../constants");
const { clamp, percent, round2 } = require("../../../utils/scoreMath.util");

const daysAgo = (days) => new Date(Date.now() - days * 24 * 3600 * 1000);

/**
 * No agent owns platform-wide numbers — everything here reads the LMS's own
 * tables directly. Two honest adaptations, since this LMS has neither a
 * Payment/Transaction model nor an APM/monitoring stack:
 *
 * - REVENUE_READY is an *attributed* estimate (enrollments x course price),
 *   not real billing revenue — there is no payment gateway integration in
 *   this codebase to read actual transactions from.
 * - SYSTEM_HEALTH is a lightweight DB-round-trip-latency proxy, not a real
 *   observability signal — a genuine one would come from an APM stack, out
 *   of this agent's boundary to fabricate.
 *
 * @returns {Promise<import("../../../types/analytics.types").MetricRecord[]>}
 */
const calculatePlatformMetrics = async () => {
  const [dau, wau, mau, aiEvents, aiDistinctStudents, categoryBreakdown, priorCohort, currentCohort, enrollmentCounts, dbLatencyMs] =
    await Promise.all([
      prisma.studentActivityState.count({ where: { lastActiveAt: { gte: daysAgo(DAU_WINDOW_DAYS) } } }),
      prisma.studentActivityState.count({ where: { lastActiveAt: { gte: daysAgo(WEEKLY_ACTIVE_WINDOW_DAYS) } } }),
      prisma.studentActivityState.count({ where: { lastActiveAt: { gte: daysAgo(MAU_WINDOW_DAYS) } } }),
      prisma.learningEvent.count({
        where: { createdAt: { gte: daysAgo(AI_USAGE_WINDOW_DAYS) }, OR: [{ eventCategory: "AI_CHAT" }, { eventType: "AI_HINT_REQUESTED" }] },
      }),
      prisma.learningEvent.findMany({
        where: { createdAt: { gte: daysAgo(AI_USAGE_WINDOW_DAYS) }, OR: [{ eventCategory: "AI_CHAT" }, { eventType: "AI_HINT_REQUESTED" }] },
        distinct: ["studentId"],
        select: { studentId: true },
      }),
      prisma.learningEvent.groupBy({ by: ["eventCategory"], where: { createdAt: { gte: daysAgo(MAU_WINDOW_DAYS) } }, _count: { _all: true } }),
      prisma.learningEvent.findMany({
        where: { createdAt: { gte: daysAgo(2 * RETENTION_WINDOW_DAYS), lt: daysAgo(RETENTION_WINDOW_DAYS) } },
        distinct: ["studentId"],
        select: { studentId: true },
      }),
      prisma.learningEvent.findMany({
        where: { createdAt: { gte: daysAgo(RETENTION_WINDOW_DAYS) } },
        distinct: ["studentId"],
        select: { studentId: true },
      }),
      prisma.enrollment.groupBy({ by: ["courseId"], _count: { _all: true } }),
      measureDbLatency(),
    ]);

  const priorIds = new Set(priorCohort.map((r) => r.studentId));
  const currentIds = new Set(currentCohort.map((r) => r.studentId));
  const retainedCount = [...priorIds].filter((id) => currentIds.has(id)).length;
  const retentionPercent = percent(retainedCount, priorIds.size);
  const churnPercent = priorIds.size === 0 ? 0 : round2(100 - retentionPercent);

  const revenue = await calculateAttributedRevenue(enrollmentCounts);

  const healthScore = clamp(100 - dbLatencyMs, 0, 100);

  return [
    { metricKey: METRIC_KEY.ACTIVE_USERS, value: wau, unit: "count", metadata: { windowDays: WEEKLY_ACTIVE_WINDOW_DAYS } },
    { metricKey: METRIC_KEY.DAILY_ACTIVE_USERS, value: dau, unit: "count" },
    { metricKey: METRIC_KEY.MONTHLY_ACTIVE_USERS, value: mau, unit: "count" },
    {
      metricKey: METRIC_KEY.AI_USAGE,
      value: aiEvents,
      unit: "count",
      metadata: { distinctStudents: aiDistinctStudents.length, windowDays: AI_USAGE_WINDOW_DAYS },
    },
    {
      metricKey: METRIC_KEY.FEATURE_USAGE,
      value: categoryBreakdown.reduce((sum, c) => sum + c._count._all, 0),
      unit: "count",
      metadata: { breakdown: categoryBreakdown.map((c) => ({ category: c.eventCategory, count: c._count._all })) },
    },
    { metricKey: METRIC_KEY.RETENTION, value: retentionPercent, unit: "%", metadata: { priorCohortSize: priorIds.size, retainedCount } },
    { metricKey: METRIC_KEY.CHURN, value: churnPercent, unit: "%" },
    { metricKey: METRIC_KEY.REVENUE_READY, value: revenue, unit: "INR", metadata: { note: "attributed estimate, not real billing revenue" } },
    {
      metricKey: METRIC_KEY.SYSTEM_HEALTH,
      value: healthScore,
      unit: "score",
      metadata: { dbLatencyMs, uptimeSeconds: Math.round(process.uptime()), note: "DB-latency proxy, not a real APM signal" },
    },
  ];
};

const measureDbLatency = async () => {
  const start = Date.now();
  await prisma.$queryRaw`SELECT 1`;
  return Date.now() - start;
};

const calculateAttributedRevenue = async (enrollmentCounts) => {
  const courseIds = enrollmentCounts.map((e) => e.courseId);
  if (courseIds.length === 0) return 0;

  const stores = await prisma.store.findMany({ where: { courseId: { in: courseIds } } });
  const storeByCourse = new Map(stores.map((s) => [s.courseId, s]));

  return round2(
    enrollmentCounts.reduce((sum, e) => {
      const store = storeByCourse.get(e.courseId);
      if (!store || store.isFree) return sum;
      const price = store.discountPrice ?? store.price;
      return sum + price * e._count._all;
    }, 0)
  );
};

module.exports = { calculatePlatformMetrics };
