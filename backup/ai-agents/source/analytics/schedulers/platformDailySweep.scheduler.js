const cron = require("node-cron");

const prisma = require("../../../config/database");
const analyticsService = require("../services/analytics.service");
const kpiRepository = require("../repositories/kpi.repository");
const snapshotRepository = require("../repositories/analyticsSnapshot.repository");
const { SCOPE_TYPE, PLATFORM_SCOPE_ID, PLATFORM_SWEEP_CRON } = require("../constants");

/** Bundles a scope's current KPI rows into one wide AnalyticsSnapshot document for the day — reads already-computed KPIs, doesn't recompute. */
const snapshotScope = async (scopeType, scopeId, now) => {
  const kpis = await kpiRepository.findByScope(scopeType, scopeId);
  if (kpis.length === 0) return false;

  const metrics = {};
  for (const kpi of kpis) metrics[kpi.metricKey] = kpi.value;

  await snapshotRepository.upsertDaily(scopeType, scopeId, metrics, { kpiCount: kpis.length }, now);
  return true;
};

/**
 * PLATFORM-scope recompute (too heavy for per-event freshness) plus the
 * daily AnalyticsSnapshot bundle for platform + every course + every
 * instructor. Per-student snapshots are deliberately NOT bulk-built here —
 * only students who've had a real-time recompute get history/snapshot rows,
 * which is enough for their own trend/forecast; snapshotting the entire
 * user base daily doesn't scale the same way a handful of courses/
 * instructors does.
 */
const runOnce = async () => {
  const now = new Date();

  await analyticsService.generateForScope(SCOPE_TYPE.PLATFORM, PLATFORM_SCOPE_ID, "platform-daily-sweep");
  await snapshotScope(SCOPE_TYPE.PLATFORM, PLATFORM_SCOPE_ID, now);

  const courses = await prisma.course.findMany({ select: { id: true } });
  let courseSnapshotted = 0;
  for (const { id } of courses) {
    if (await snapshotScope(SCOPE_TYPE.COURSE, id, now)) courseSnapshotted += 1;
  }

  const instructors = await prisma.course.findMany({ select: { creatorId: true }, distinct: ["creatorId"] });
  let instructorSnapshotted = 0;
  for (const { creatorId } of instructors) {
    if (await snapshotScope(SCOPE_TYPE.INSTRUCTOR, creatorId, now)) instructorSnapshotted += 1;
  }

  console.log(`[analytics:platformDailySweep] snapshotted platform + ${courseSnapshotted} course(s) + ${instructorSnapshotted} instructor(s)`);
  return { courseSnapshotted, instructorSnapshotted };
};

const start = () => {
  cron.schedule(PLATFORM_SWEEP_CRON, () => {
    runOnce().catch((error) => console.error("[analytics:platformDailySweep] run failed:", error));
  });

  console.log(`[analytics:platformDailySweep] scheduled (${PLATFORM_SWEEP_CRON})`);
};

module.exports = { start, runOnce };
