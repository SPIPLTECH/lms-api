const test = require("node:test");
const assert = require("node:assert/strict");

const { calculateFacultyAnalytics } = require("../services/domain/facultyAggregator");
const { FACULTY_OVERLOAD_COURSE_COUNT } = require("../constants");

const courseHealth = (score) => ({
  courseHealthScore: score,
  classEngagementScore: score,
  classPerformanceScore: score,
  completionRate: score,
  atRiskStudentPercent: 100 - score,
  enrolledCount: 10,
  activeStudentCount: 5,
});

test("calculateFacultyAnalytics flags an instructor teaching >= FACULTY_OVERLOAD_COURSE_COUNT courses", () => {
  const courses = Array.from({ length: FACULTY_OVERLOAD_COURSE_COUNT }, (_, i) => ({
    courseId: `c${i}`,
    courseHealth: courseHealth(70),
  }));
  const context = {
    instructors: [{ id: "i1", status: "ACTIVE" }],
    teacherDashboards: { i1: { courses } },
    instructorKpisByInstructor: {},
  };
  const [faculty] = calculateFacultyAnalytics(context);
  assert.equal(faculty.overloadFlag, true);
});

test("calculateFacultyAnalytics flags an instructor with zero active students as inactive", () => {
  const context = {
    instructors: [{ id: "i1", status: "ACTIVE" }],
    teacherDashboards: { i1: { courses: [{ courseId: "c1", courseHealth: { ...courseHealth(70), activeStudentCount: 0 } }] } },
    instructorKpisByInstructor: {},
  };
  const [faculty] = calculateFacultyAnalytics(context);
  assert.equal(faculty.inactiveFlag, true);
});

test("calculateFacultyAnalytics flags a non-ACTIVE user status as inactive regardless of engagement", () => {
  const context = {
    instructors: [{ id: "i1", status: "SUSPENDED" }],
    teacherDashboards: { i1: { courses: [{ courseId: "c1", courseHealth: courseHealth(90) }] } },
    instructorKpisByInstructor: {},
  };
  const [faculty] = calculateFacultyAnalytics(context);
  assert.equal(faculty.inactiveFlag, true);
});

test("calculateFacultyAnalytics prefers Analytics' real TEACHING_EFFECTIVENESS KPI over the CourseHealth proxy when available", () => {
  const context = {
    instructors: [{ id: "i1", status: "ACTIVE" }],
    teacherDashboards: { i1: { courses: [{ courseId: "c1", courseHealth: courseHealth(50) }] } },
    instructorKpisByInstructor: { i1: [{ metricKey: "TEACHING_EFFECTIVENESS", value: 99 }] },
  };
  const [faculty] = calculateFacultyAnalytics(context);
  assert.equal(faculty.averageTeachingEffectiveness, 99);
});

test("calculateFacultyAnalytics handles an instructor with no courses", () => {
  const context = { instructors: [{ id: "i1", status: "ACTIVE" }], teacherDashboards: {}, instructorKpisByInstructor: {} };
  const [faculty] = calculateFacultyAnalytics(context);
  assert.equal(faculty.courseCount, 0);
  assert.equal(faculty.inactiveFlag, false); // no courses -> not flagged inactive (nothing to be inactive at)
});
