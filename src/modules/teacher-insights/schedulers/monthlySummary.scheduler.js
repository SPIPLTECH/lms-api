const cron = require("node-cron");

const prisma = require("../../../config/database");
const teacherInsightService = require("../services/teacherInsight.service");
const { TEACHER_REPORT_TYPE } = require("../constants");

const CRON_EXPRESSION = "0 6 1 * *"; // 1st of every month, 06:00 server time

/** Generates the MONTHLY_SUMMARY report for every course with at least one enrollment. */
const runOnce = async () => {
  const courses = await prisma.enrollment.findMany({ select: { courseId: true }, distinct: ["courseId"] });

  let succeeded = 0;
  for (const { courseId } of courses) {
    try {
      await teacherInsightService.buildAndPersistReport(courseId, TEACHER_REPORT_TYPE.MONTHLY_SUMMARY);
      succeeded += 1;
    } catch (error) {
      console.error(`[teacher-insights:monthlySummary] failed for course ${courseId}:`, error.message);
    }
  }

  console.log(`[teacher-insights:monthlySummary] generated ${succeeded}/${courses.length} monthly summaries`);
  return { succeeded, total: courses.length };
};

const start = () => {
  cron.schedule(CRON_EXPRESSION, () => {
    runOnce().catch((error) => {
      console.error("[teacher-insights:monthlySummary] run failed:", error);
    });
  });

  console.log(`[teacher-insights:monthlySummary] scheduled (${CRON_EXPRESSION})`);
};

module.exports = { start, runOnce };
