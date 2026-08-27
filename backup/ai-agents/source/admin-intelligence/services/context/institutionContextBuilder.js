const prisma = require("../../../../config/database");

const analytics = require("../../../analytics");
const studentState = require("../../../student-state");
const teacherInsights = require("../../../teacher-insights");

const RISK_LEVELS_FOR_DETECTION = ["HIGH", "MEDIUM"];

/**
 * Gathers everything one generateInsights() run needs, all real reads: no
 * raw event re-derivation of what a peer agent already owns (see this
 * module's index.js doc for the full "aggregates the aggregators, one
 * level up" rationale). Runs on this agent's own debounce/daily-sweep
 * cadence only — never per-event — so the sequential per-instructor
 * getTeacherDashboard() loop below is acceptable (same pattern Analytics'
 * own platformDailySweep.scheduler.js uses looping over courses/instructors).
 */
const buildInstitutionContext = async () => {
  const now = new Date();

  const [platformSnapshot, courses, instructors, highRiskStudents, enrollments, certificates, totalStudentCount] = await Promise.all([
    analytics.getPlatformKPIs(),
    prisma.course.findMany({
      select: { id: true, title: true, category: true, description: true, status: true, creatorId: true, createdAt: true },
    }),
    prisma.user.findMany({ where: { role: "INSTRUCTOR" }, select: { id: true, name: true, status: true } }),
    studentState.getHighRiskStudents(RISK_LEVELS_FOR_DETECTION),
    prisma.enrollment.findMany({ select: { studentId: true, courseId: true, enrolledAt: true } }),
    prisma.certificate.findMany({ select: { studentId: true, courseId: true, issuedAt: true } }),
    prisma.studentProfile.count(),
  ]);

  const courseIds = courses.map((c) => c.id);
  const instructorIds = instructors.map((i) => i.id);

  const [courseKpisByCourse, instructorKpisByInstructor] = await Promise.all([
    analytics.getCourseKPIsBatch(courseIds),
    analytics.getInstructorKPIsBatch(instructorIds),
  ]);

  const teacherDashboards = {};
  for (const instructor of instructors) {
    teacherDashboards[instructor.id] = await teacherInsights.getTeacherDashboard(instructor.id);
  }

  const courseHealthByCourseId = {};
  for (const dashboard of Object.values(teacherDashboards)) {
    for (const courseEntry of dashboard.courses) {
      if (courseEntry.courseHealth) courseHealthByCourseId[courseEntry.courseId] = courseEntry.courseHealth;
    }
  }

  return {
    now,
    platformSnapshot,
    courses,
    instructors,
    teacherDashboards,
    courseHealthByCourseId,
    courseKpisByCourse,
    instructorKpisByInstructor,
    highRiskStudents,
    enrollments,
    certificates,
    totalStudentCount,
  };
};

module.exports = { buildInstitutionContext };
