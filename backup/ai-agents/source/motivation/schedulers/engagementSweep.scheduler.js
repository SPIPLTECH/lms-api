const cron = require("node-cron");

const prisma = require("../../../config/database");
const studentState = require("../../student-state");
const trendRepository = require("../repositories/engagementTrend.repository");
const motivationService = require("../services/motivation.service");

const CRON_EXPRESSION = "0 3 * * *"; // once daily, 03:00 server time

/**
 * Daily sweep with three jobs:
 *  1. Snapshot today's EngagementTrend row for every enrolled student, from
 *     Student State's already-computed scores — this is what makes trend
 *     detection (IMPROVING/DECLINING/STABLE) possible; a single point-in-
 *     time read can't tell direction.
 *  2. Regenerate the full motivation state for every enrolled student —
 *     this is what actually detects inactivity, broken streaks, missed
 *     goals, and burnout for students who haven't triggered a real-time
 *     event recently (an inactive student, almost by definition, isn't
 *     generating Student State updates).
 *  3. Expire ACTIVE actions past their expiresAt.
 */
const runOnce = async () => {
  const now = new Date();

  const enrollments = await prisma.enrollment.findMany({ select: { studentId: true }, distinct: ["studentId"] });

  let snapshotted = 0;
  let regenerated = 0;

  for (const { studentId } of enrollments) {
    try {
      const state = await studentState.getFullState(studentId);
      await trendRepository.upsertSnapshot(
        studentId,
        {
          engagementScore: state.scores.engagementScore,
          performanceScore: state.scores.performanceScore,
          dropoutRiskScore: state.risk.dropoutRiskScore,
          dailyStudyTimeSeconds: state.engagement.dailyStudyTimeSeconds,
        },
        now
      );
      snapshotted += 1;
    } catch (error) {
      // No Student State yet for this student — nothing to snapshot, not an error.
    }

    try {
      await motivationService.generateForStudent(studentId, "engagement-sweep");
      regenerated += 1;
    } catch (error) {
      console.error(`[motivation:engagementSweep] failed to regenerate for ${studentId}:`, error.message);
    }
  }

  const expiredCount = await motivationService.expireStaleActions(now);

  console.log(
    `[motivation:engagementSweep] snapshotted ${snapshotted}, regenerated ${regenerated}/${enrollments.length}, expired ${expiredCount}`
  );
  return { snapshotted, regenerated, expiredCount, total: enrollments.length };
};

const start = () => {
  cron.schedule(CRON_EXPRESSION, () => {
    runOnce().catch((error) => {
      console.error("[motivation:engagementSweep] run failed:", error);
    });
  });

  console.log(`[motivation:engagementSweep] scheduled (${CRON_EXPRESSION})`);
};

module.exports = { start, runOnce };
