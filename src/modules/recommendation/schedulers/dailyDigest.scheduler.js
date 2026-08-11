const cron = require("node-cron");

const prisma = require("../../../config/database");
const recommendationService = require("../services/recommendation.service");

const CRON_EXPRESSION = "0 2 * * *"; // once daily, 02:00 server time

/**
 * Daily sweep with three jobs:
 *  1. Expire ACTIVE recommendations past their expiresAt (time-based decay
 *     that event/scheduler triggers alone wouldn't catch).
 *  2. Regenerate DAILY_LEARNING_TASKS / WEEKLY_LEARNING_GOALS (and
 *     everything else) for every enrolled student.
 *  3. By virtue of (2) re-reading live Course/StudentProfile state on every
 *     run, this is also what satisfies the "New Course Published" and
 *     "Student Goal Changed" business triggers — neither has a dedicated
 *     Observation EventType today, so there's no real-time hook for them;
 *     this daily pass is the adaptation (see module README in index.js).
 */
const runOnce = async () => {
  const now = new Date();
  const expiredCount = await recommendationService.expireStaleRecommendations(now);

  const enrollments = await prisma.enrollment.findMany({
    select: { studentId: true },
    distinct: ["studentId"],
  });

  let succeeded = 0;
  for (const { studentId } of enrollments) {
    try {
      await recommendationService.generateForStudent(studentId, "daily-digest");
      succeeded += 1;
    } catch (error) {
      console.error(`[recommendation:dailyDigest] failed to regenerate for ${studentId}:`, error.message);
    }
  }

  console.log(`[recommendation:dailyDigest] expired ${expiredCount}, regenerated ${succeeded}/${enrollments.length} students`);
  return { expiredCount, succeeded, total: enrollments.length };
};

const start = () => {
  cron.schedule(CRON_EXPRESSION, () => {
    runOnce().catch((error) => {
      console.error("[recommendation:dailyDigest] run failed:", error);
    });
  });

  console.log(`[recommendation:dailyDigest] scheduled (${CRON_EXPRESSION})`);
};

module.exports = { start, runOnce };
