const { UNCATEGORIZED_DEPARTMENT_KEY } = require("../../constants");
const { average, round2, clamp } = require("../../utils/scoreMath.util");
const { computeEnrollmentGrowthPercent } = require("../../utils/growth.util");

const groupBy = (items, keyFn) => {
  const groups = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return groups;
};

/**
 * "Department" = Course.category — the only real institutional grouping
 * dimension in this LMS (no Department model exists). Every number here is
 * read from Teacher Insight's real CourseHealth rows (via
 * context.courseHealthByCourseId, already flattened from every instructor's
 * dashboard) plus real Enrollment rows — this engine aggregates, it never
 * re-derives course-health scoring itself.
 *
 * @param {import("../../types/adminIntelligence.types").InstitutionContext} context
 */
const calculateDepartmentAnalytics = (context) => {
  const { courses, courseHealthByCourseId, enrollments, now } = context;

  const enrollmentsByCourse = groupBy(enrollments, (e) => e.courseId);
  const coursesByDepartment = groupBy(courses, (c) => c.category || UNCATEGORIZED_DEPARTMENT_KEY);

  return [...coursesByDepartment.entries()].map(([departmentKey, deptCourses]) => {
    const courseCount = deptCourses.length;
    const deptEnrollments = deptCourses.flatMap((c) => enrollmentsByCourse.get(c.id) || []);
    const activeStudentCount = new Set(deptEnrollments.map((e) => e.studentId)).size;

    const healths = deptCourses.map((c) => courseHealthByCourseId[c.id]).filter(Boolean);
    const averageCompletionRate = round2(average(healths.map((h) => h.completionRate)));
    const averageCourseHealthScore = round2(average(healths.map((h) => h.courseHealthScore)));
    const atRiskStudentPercent = round2(average(healths.map((h) => h.atRiskStudentPercent)));

    const enrollmentTrendPercent = computeEnrollmentGrowthPercent(deptEnrollments, now);

    const healthScore = round2(average([averageCompletionRate, averageCourseHealthScore, clamp(100 - atRiskStudentPercent)]));

    return {
      departmentKey,
      courseCount,
      activeStudentCount,
      averageCompletionRate,
      averageCourseHealthScore,
      atRiskStudentPercent,
      enrollmentTrendPercent,
      healthScore,
    };
  });
};

module.exports = { calculateDepartmentAnalytics };
