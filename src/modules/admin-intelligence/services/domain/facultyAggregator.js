const { FACULTY_OVERLOAD_COURSE_COUNT } = require("../../constants");
const { average, round2 } = require("../../utils/scoreMath.util");

/**
 * "Faculty" = instructor (User.role=INSTRUCTOR, scoped by Course.creatorId)
 * — no Faculty/Department-staff model exists in this LMS. Every number here
 * is read from Teacher Insight's real getTeacherDashboard(instructorId) —
 * courseHealth per course — plus Analytics' real INSTRUCTOR-scope
 * TEACHING_EFFECTIVENESS KPI where it's already been computed; this engine
 * aggregates, it never re-derives what those two agents already own.
 *
 * @param {import("../../types/adminIntelligence.types").InstitutionContext} context
 */
const calculateFacultyAnalytics = (context) => {
  const { instructors, teacherDashboards, instructorKpisByInstructor } = context;

  return instructors.map((instructor) => {
    const dashboard = teacherDashboards[instructor.id];
    const courses = dashboard?.courses || [];
    const healths = courses.map((c) => c.courseHealth).filter(Boolean);

    const courseCount = courses.length;
    const activeStudentCount = healths.reduce((sum, h) => sum + (h.activeStudentCount || 0), 0);
    const averageCourseHealthScore = round2(average(healths.map((h) => h.courseHealthScore)));
    const averageEngagementScore = round2(average(healths.map((h) => h.classEngagementScore)));

    const instructorKpis = instructorKpisByInstructor[instructor.id] || [];
    const teachingEffectivenessKpi = instructorKpis.find((k) => k.metricKey === "TEACHING_EFFECTIVENESS");
    // Fall back to the course-health performance proxy only when Analytics
    // hasn't computed this instructor's KPI yet (e.g. brand-new instructor,
    // no INSTRUCTOR-scope recompute has fired for them) — never silently
    // treated as equally authoritative in reporting, just a stand-in value.
    const averageTeachingEffectiveness = teachingEffectivenessKpi
      ? teachingEffectivenessKpi.value
      : round2(average(healths.map((h) => h.classPerformanceScore)));

    const overloadFlag = courseCount >= FACULTY_OVERLOAD_COURSE_COUNT;
    const inactiveFlag = instructor.status !== "ACTIVE" || (courseCount > 0 && activeStudentCount === 0);

    const performanceScore = round2(average([averageCourseHealthScore, averageEngagementScore, averageTeachingEffectiveness]));

    return {
      instructorId: instructor.id,
      courseCount,
      activeStudentCount,
      averageCourseHealthScore,
      averageEngagementScore,
      averageTeachingEffectiveness,
      overloadFlag,
      inactiveFlag,
      performanceScore,
    };
  });
};

module.exports = { calculateFacultyAnalytics };
