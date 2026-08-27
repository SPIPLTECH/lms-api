const cron = require("node-cron");

const prisma = require("../../../config/database");
const teacherInsightService = require("../services/teacherInsight.service");

const CRON_EXPRESSION = "0 4 * * *"; // once daily, 04:00 server time

/**
 * The real safety net, same "events accelerate freshness, the sweep
 * guarantees correctness" pattern as Recommendation/Motivation — recomputes
 * every course that has at least one enrollment, catching courses whose
 * students haven't triggered a real-time event recently (a fully inactive
 * class, almost by definition, won't be generating Student State updates).
 * No separate expiry sweep needed here: unlike Recommendation/Motivation's
 * personal reminders, these insights have no TTL — they simply stay ACTIVE
 * until recompute finds they no longer apply.
 */
const runOnce = async () => {
  const courses = await prisma.enrollment.findMany({ select: { courseId: true }, distinct: ["courseId"] });

  let succeeded = 0;
  for (const { courseId } of courses) {
    try {
      await teacherInsightService.generateForCourse(courseId, "daily-class-sweep");
      succeeded += 1;
    } catch (error) {
      console.error(`[teacher-insights:dailyClassSweep] failed to regenerate for course ${courseId}:`, error.message);
    }
  }

  console.log(`[teacher-insights:dailyClassSweep] regenerated ${succeeded}/${courses.length} courses`);
  return { succeeded, total: courses.length };
};

const start = () => {
  cron.schedule(CRON_EXPRESSION, () => {
    runOnce().catch((error) => {
      console.error("[teacher-insights:dailyClassSweep] run failed:", error);
    });
  });

  console.log(`[teacher-insights:dailyClassSweep] scheduled (${CRON_EXPRESSION})`);
};

module.exports = { start, runOnce };
