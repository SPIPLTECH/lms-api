const cron = require("node-cron");

const prisma = require("../../../config/database");
const analyticsService = require("../services/analytics.service");
const { SCOPE_TYPE, COURSE_INSTRUCTOR_SWEEP_CRON } = require("../constants");

/**
 * COURSE/INSTRUCTOR-scope metrics are full-population aggregations, too
 * heavy to recompute on every underlying event (see events/eventConsumer.js)
 * — this hourly sweep is the real safety net, same "events accelerate
 * freshness, the sweep guarantees correctness" pattern used throughout this
 * agent series. Catches courses/instructors whose activity hasn't triggered
 * a TeacherInsightUpdated recently.
 */
const runOnce = async () => {
  const courses = await prisma.enrollment.findMany({ select: { courseId: true }, distinct: ["courseId"] });
  const instructors = await prisma.course.findMany({ select: { creatorId: true }, distinct: ["creatorId"] });

  let courseSucceeded = 0;
  for (const { courseId } of courses) {
    try {
      await analyticsService.generateForScope(SCOPE_TYPE.COURSE, courseId, "course-instructor-sweep");
      courseSucceeded += 1;
    } catch (error) {
      console.error(`[analytics:courseInstructorSweep] failed for course ${courseId}:`, error.message);
    }
  }

  let instructorSucceeded = 0;
  for (const { creatorId } of instructors) {
    try {
      await analyticsService.generateForScope(SCOPE_TYPE.INSTRUCTOR, creatorId, "course-instructor-sweep");
      instructorSucceeded += 1;
    } catch (error) {
      console.error(`[analytics:courseInstructorSweep] failed for instructor ${creatorId}:`, error.message);
    }
  }

  console.log(
    `[analytics:courseInstructorSweep] courses ${courseSucceeded}/${courses.length}, instructors ${instructorSucceeded}/${instructors.length}`
  );
  return { courseSucceeded, courseTotal: courses.length, instructorSucceeded, instructorTotal: instructors.length };
};

const start = () => {
  cron.schedule(COURSE_INSTRUCTOR_SWEEP_CRON, () => {
    runOnce().catch((error) => console.error("[analytics:courseInstructorSweep] run failed:", error));
  });

  console.log(`[analytics:courseInstructorSweep] scheduled (${COURSE_INSTRUCTOR_SWEEP_CRON})`);
};

module.exports = { start, runOnce };
