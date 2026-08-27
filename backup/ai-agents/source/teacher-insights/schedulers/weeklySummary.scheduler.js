const cron = require("node-cron");

const prisma = require("../../../config/database");
const teacherInsightService = require("../services/teacherInsight.service");
const { TEACHER_REPORT_TYPE } = require("../constants");

const CRON_EXPRESSION = "0 5 * * 1"; // every Monday, 05:00 server time

/** Generates the WEEKLY_SUMMARY report for every course with at least one enrollment. */
const runOnce = async () => {
  const courses = await prisma.enrollment.findMany({ select: { courseId: true }, distinct: ["courseId"] });

  let succeeded = 0;
  for (const { courseId } of courses) {
    try {
      await teacherInsightService.buildAndPersistReport(courseId, TEACHER_REPORT_TYPE.WEEKLY_SUMMARY);
      succeeded += 1;
    } catch (error) {
      console.error(`[teacher-insights:weeklySummary] failed for course ${courseId}:`, error.message);
    }
  }

  console.log(`[teacher-insights:weeklySummary] generated ${succeeded}/${courses.length} weekly summaries`);
  return { succeeded, total: courses.length };
};

const start = () => {
  cron.schedule(CRON_EXPRESSION, () => {
    runOnce().catch((error) => {
      console.error("[teacher-insights:weeklySummary] run failed:", error);
    });
  });

  console.log(`[teacher-insights:weeklySummary] scheduled (${CRON_EXPRESSION})`);
};

module.exports = { start, runOnce };
