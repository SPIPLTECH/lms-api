const cron = require("node-cron");

const prisma = require("../../../config/database");
const careerService = require("../services/career.service");
const { DAILY_SAFETY_SWEEP_CRON } = require("../constants");

/**
 * The real safety net for "course completed"/"certificate earned"/"project
 * completed" — none of those has a real-time hook anywhere in this
 * codebase (nothing publishes those signals today), so this daily sweep
 * reading live state is what actually keeps career profiles current for
 * activity the event consumer can't see. Same "events accelerate
 * freshness, the sweep guarantees correctness" pattern used throughout
 * this agent series.
 */
const runOnce = async () => {
  const students = await prisma.enrollment.findMany({ select: { studentId: true }, distinct: ["studentId"] });

  let succeeded = 0;
  for (const { studentId } of students) {
    try {
      await careerService.generateForStudent(studentId, "daily-safety-sweep");
      succeeded += 1;
    } catch (error) {
      console.error(`[career:dailySafetySweep] failed for student ${studentId}:`, error.message);
    }
  }

  console.log(`[career:dailySafetySweep] regenerated ${succeeded}/${students.length} students`);
  return { succeeded, total: students.length };
};

const start = () => {
  cron.schedule(DAILY_SAFETY_SWEEP_CRON, () => {
    runOnce().catch((error) => console.error("[career:dailySafetySweep] run failed:", error));
  });

  console.log(`[career:dailySafetySweep] scheduled (${DAILY_SAFETY_SWEEP_CRON})`);
};

module.exports = { start, runOnce };
