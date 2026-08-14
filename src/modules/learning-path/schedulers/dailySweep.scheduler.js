const cron = require("node-cron");

const prisma = require("../../../config/database");
const learningPathService = require("../services/learningPath.service");
const { DAILY_SWEEP_CRON } = require("../constants");

/**
 * The real safety net — same "events accelerate freshness, the sweep
 * guarantees correctness" pattern used throughout this agent series.
 * Recomputes every enrolled student, catching anyone whose activity hasn't
 * triggered a student-state:updated recently.
 */
const runOnce = async () => {
  const students = await prisma.enrollment.findMany({ select: { studentId: true }, distinct: ["studentId"] });

  let succeeded = 0;
  for (const { studentId } of students) {
    try {
      await learningPathService.generateForStudent(studentId, "daily-sweep");
      succeeded += 1;
    } catch (error) {
      console.error(`[learning-path:dailySweep] failed for student ${studentId}:`, error.message);
    }
  }

  console.log(`[learning-path:dailySweep] regenerated ${succeeded}/${students.length} students`);
  return { succeeded, total: students.length };
};

const start = () => {
  cron.schedule(DAILY_SWEEP_CRON, () => {
    runOnce().catch((error) => console.error("[learning-path:dailySweep] run failed:", error));
  });

  console.log(`[learning-path:dailySweep] scheduled (${DAILY_SWEEP_CRON})`);
};

module.exports = { start, runOnce };
