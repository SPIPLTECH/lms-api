const cron = require("node-cron");

const prisma = require("../../../config/database");
const placementService = require("../services/placement.service");
const { DAILY_SWEEP_CRON } = require("../constants");

/**
 * The real safety net for "resume/portfolio updated"/"certification
 * completed"/"new job or internship posted" — none of those has a
 * real-time hook anywhere in this codebase, so this daily sweep reading
 * live state is what actually keeps placement profiles current for
 * activity the event consumer can't see. Same "events accelerate
 * freshness, the sweep guarantees correctness" pattern used throughout
 * this agent series.
 */
const runOnce = async () => {
  const students = await prisma.enrollment.findMany({ select: { studentId: true }, distinct: ["studentId"] });

  let succeeded = 0;
  for (const { studentId } of students) {
    try {
      await placementService.generateForStudent(studentId, "daily-sweep");
      succeeded += 1;
    } catch (error) {
      console.error(`[placement:dailySweep] failed for student ${studentId}:`, error.message);
    }
  }

  console.log(`[placement:dailySweep] regenerated ${succeeded}/${students.length} students`);
  return { succeeded, total: students.length };
};

const start = () => {
  cron.schedule(DAILY_SWEEP_CRON, () => {
    runOnce().catch((error) => console.error("[placement:dailySweep] run failed:", error));
  });

  console.log(`[placement:dailySweep] scheduled (${DAILY_SWEEP_CRON})`);
};

module.exports = { start, runOnce };
