const test = require("node:test");
const assert = require("node:assert/strict");

const { calculateCourseHealth } = require("../services/domain/courseHealthCalculator");
const { makeContext } = require("./helpers/makeContext");

test("calculateCourseHealth returns all zeros for a course with no enrollment", () => {
  const result = calculateCourseHealth(makeContext({ enrolledCount: 0, studentStates: [] }), 0);
  assert.equal(result.courseHealthScore, 0);
  assert.equal(result.enrolledCount, 0);
});

test("calculateCourseHealth blends engagement, performance, completion, and risk", () => {
  const context = makeContext({
    enrolledCount: 2,
    studentStates: [
      { studentId: "s1", scores: { engagementScore: 80, performanceScore: 80 }, engagement: { lastActiveAt: new Date("2026-01-10T00:00:00.000Z") } },
      { studentId: "s2", scores: { engagementScore: 60, performanceScore: 60 }, engagement: { lastActiveAt: new Date("2026-01-10T00:00:00.000Z") } },
    ],
    lessons: [{ id: "l1", completedCount: 2 }],
  });

  const result = calculateCourseHealth(context, 0);
  assert.equal(result.classEngagementScore, 70);
  assert.equal(result.classPerformanceScore, 70);
  assert.equal(result.completionRate, 100);
  assert.equal(result.atRiskStudentPercent, 0);
  assert.ok(result.courseHealthScore > 0);
});

test("calculateCourseHealth reduces the score as at-risk percentage rises", () => {
  const context = makeContext({
    enrolledCount: 4,
    studentStates: [
      { studentId: "s1", scores: { engagementScore: 70, performanceScore: 70 }, engagement: {} },
      { studentId: "s2", scores: { engagementScore: 70, performanceScore: 70 }, engagement: {} },
    ],
    lessons: [],
  });

  const noRisk = calculateCourseHealth(context, 0);
  const highRisk = calculateCourseHealth(context, 3);
  assert.ok(highRisk.courseHealthScore < noRisk.courseHealthScore);
});

test("calculateCourseHealth counts only recently active students as activeStudentCount", () => {
  const context = makeContext({
    enrolledCount: 2,
    now: new Date("2026-01-10T00:00:00.000Z"),
    studentStates: [
      { studentId: "s1", scores: {}, engagement: { lastActiveAt: new Date("2026-01-09T00:00:00.000Z") } },
      { studentId: "s2", scores: {}, engagement: { lastActiveAt: new Date("2025-12-01T00:00:00.000Z") } },
    ],
  });

  const result = calculateCourseHealth(context, 0);
  assert.equal(result.activeStudentCount, 1);
});
