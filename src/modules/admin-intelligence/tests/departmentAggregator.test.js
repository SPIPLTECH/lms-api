const test = require("node:test");
const assert = require("node:assert/strict");

const { calculateDepartmentAnalytics } = require("../services/domain/departmentAggregator");

const courseHealth = (score) => ({
  courseHealthScore: score,
  classEngagementScore: score,
  classPerformanceScore: score,
  completionRate: score,
  atRiskStudentPercent: 100 - score,
  enrolledCount: 10,
  activeStudentCount: 5,
});

test("calculateDepartmentAnalytics groups courses by category", () => {
  const context = {
    now: new Date(),
    courses: [
      { id: "c1", category: "Programming" },
      { id: "c2", category: "Programming" },
      { id: "c3", category: "Design" },
    ],
    courseHealthByCourseId: { c1: courseHealth(80), c2: courseHealth(60), c3: courseHealth(90) },
    enrollments: [],
  };
  const departments = calculateDepartmentAnalytics(context);
  const byKey = Object.fromEntries(departments.map((d) => [d.departmentKey, d]));
  assert.equal(byKey.Programming.courseCount, 2);
  assert.equal(byKey.Design.courseCount, 1);
});

test("calculateDepartmentAnalytics buckets a null category under UNCATEGORIZED", () => {
  const context = {
    now: new Date(),
    courses: [{ id: "c1", category: null }],
    courseHealthByCourseId: { c1: courseHealth(70) },
    enrollments: [],
  };
  const departments = calculateDepartmentAnalytics(context);
  assert.equal(departments[0].departmentKey, "UNCATEGORIZED");
});

test("calculateDepartmentAnalytics counts distinct students across a department's courses, not enrollment rows", () => {
  const context = {
    now: new Date(),
    courses: [
      { id: "c1", category: "Programming" },
      { id: "c2", category: "Programming" },
    ],
    courseHealthByCourseId: { c1: courseHealth(80), c2: courseHealth(80) },
    enrollments: [
      { studentId: "s1", courseId: "c1", enrolledAt: new Date() },
      { studentId: "s1", courseId: "c2", enrolledAt: new Date() }, // same student, two courses -> counted once
      { studentId: "s2", courseId: "c1", enrolledAt: new Date() },
    ],
  };
  const [dept] = calculateDepartmentAnalytics(context);
  assert.equal(dept.activeStudentCount, 2);
});

test("calculateDepartmentAnalytics skips a course with no CourseHealth row yet rather than treating it as zero", () => {
  const context = {
    now: new Date(),
    courses: [
      { id: "c1", category: "Programming" },
      { id: "c2", category: "Programming" }, // no health entry
    ],
    courseHealthByCourseId: { c1: courseHealth(80) },
    enrollments: [],
  };
  const [dept] = calculateDepartmentAnalytics(context);
  assert.equal(dept.averageCourseHealthScore, 80); // averaged over 1 real entry, not (80+0)/2
});
