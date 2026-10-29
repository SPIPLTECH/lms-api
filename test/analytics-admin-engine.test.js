const test = require("node:test");
const assert = require("node:assert");

const analyticsEngine = require("../src/modules/analytics/analytics.engine");
const admin = require("../src/modules/admin-intelligence/adminIntelligence.engine");

// The invariants under test, for the Analytics and Admin Intelligence agents:
//
//  1. Analytics only measures: grouped results in, metrics out, absent data
//     reported as null, never as zero.
//  2. Admin Intelligence only reads Analytics' metrics: health is weighted by
//     enrolment, alerts fire on the stated thresholds, departments are
//     categories and faculty are instructors.

const NOW = new Date("2026-03-10T12:00:00.000Z");
const DAY = 86_400_000;

test("course metrics: completion and at-risk percentages, null when there is no evidence", () => {
  const [busy, empty] = analyticsEngine.buildCourseMetrics({
    courses: [
      { id: "c1", title: "Java", status: "PUBLISHED", category: "Programming", creatorId: "i1", createdAt: NOW },
      { id: "c2", title: "Empty", status: "PUBLISHED", category: null, creatorId: "i1", createdAt: NOW },
    ],
    enrollments: new Map([["c1", { count: 10, avgProgress: 42.26 }]]),
    completions: new Map([["c1", 2]]),
    newEnrollments: new Map([["c1", 3]]),
    quizAverages: new Map([["c1", 71.44]]),
    health: new Map([["c1", { riskCounts: { HIGH: 2, CRITICAL: 1, LOW: 7 }, activeLearners7d: 6, avgEngagement: 55.55 }]]),
  });

  assert.strictEqual(busy.metrics.completionRate, 20);
  assert.strictEqual(busy.metrics.avgProgress, 42.3);
  assert.strictEqual(busy.metrics.atRiskLearners, 3);
  assert.strictEqual(busy.metrics.atRiskPercent, 30);
  assert.strictEqual(busy.metrics.avgQuizScore30d, 71.4);
  assert.deepStrictEqual(busy.metrics.riskCounts, { NEW: 0, LOW: 7, MEDIUM: 0, HIGH: 2, CRITICAL: 1 });

  assert.strictEqual(empty.metrics.enrolled, 0);
  assert.strictEqual(empty.metrics.completionRate, null);
  assert.strictEqual(empty.metrics.avgQuizScore30d, null);
  assert.strictEqual(empty.metrics.atRiskPercent, null);
});

test("platform metrics carry learner counts through, including unknown as null", () => {
  const m = analyticsEngine.buildPlatformMetrics({
    usersByRole: { STUDENT: 50, INSTRUCTOR: 4, ADMIN: 1 },
    publishedCourses: 6,
    enrollments: 120,
    newEnrollments7d: 9,
    completions30d: 5,
    aiMessages7d: 33,
    learners: { activeLearners7d: 20, atRiskLearners: 7 },
  });
  assert.strictEqual(m.activeLearnerPercent, 40);
  assert.strictEqual(m.atRiskLearners, 7);
  const unknown = analyticsEngine.buildPlatformMetrics({ usersByRole: {}, publishedCourses: 0, enrollments: 0, newEnrollments7d: 0, completions30d: 0, aiMessages7d: 0, learners: { activeLearners7d: null, atRiskLearners: null } });
  assert.strictEqual(unknown.activeLearnerPercent, null);
});

const course = (overrides = {}) => ({
  courseId: "c1",
  title: "Java",
  status: "PUBLISHED",
  category: "Programming",
  creatorId: "i1",
  createdAt: new Date(NOW.getTime() - 90 * DAY),
  enrolled: 20,
  completed: 10,
  completionRate: 50,
  avgProgress: 60,
  avgEngagement: 60,
  activeLearners7d: 12,
  atRiskLearners: 2,
  atRiskPercent: 10,
  ...overrides,
});

test("health is weighted by enrolment and renormalised over the data present", () => {
  const h = admin.healthOf([course({ enrolled: 30, avgProgress: 80, avgEngagement: 80, atRiskLearners: 0 }), course({ enrolled: 10, avgProgress: 40, avgEngagement: 40, atRiskLearners: 10 })]);
  // progress 70, at-risk 25%, engagement 70 -> 0.4*70 + 0.3*75 + 0.3*70 = 71.5
  assert.strictEqual(h.score, 72);
  assert.strictEqual(h.level, "GOOD");
  assert.strictEqual(h.atRiskPercent, 25);
  assert.strictEqual(admin.healthOf([course({ enrolled: 0 })]).score, null);
});

test("alerts fire on the stated thresholds and are ordered HIGH first", () => {
  const dashboard = admin.buildDashboard({
    platform: { students: 40, atRiskLearners: 12, activeLearners7d: 10 },
    previousPlatform: { activeLearners7d: 20 },
    courses: [
      course({ courseId: "risky", title: "Risky", atRiskLearners: 8, atRiskPercent: 40 }),
      course({ courseId: "slow", title: "Slow", completed: 1, completionRate: 5 }),
      course({ courseId: "quiet", title: "Quiet", activeLearners7d: 0 }),
      course({ courseId: "new", title: "New", createdAt: NOW, completed: 0, completionRate: 0 }), // too new for LOW_COMPLETION
    ],
    instructorNames: new Map([["i1", "Asha"]]),
    now: NOW,
  });

  const types = dashboard.alerts.map((a) => `${a.type}:${a.courseId ?? "-"}`);
  assert.ok(types.includes("HIGH_RISK_SURGE:-"));
  assert.ok(types.includes("ENGAGEMENT_DROP:-"));
  assert.ok(types.includes("COURSE_AT_RISK:risky"));
  assert.ok(types.includes("LOW_COMPLETION:slow"));
  assert.ok(types.includes("INACTIVE_COURSE:quiet"));
  assert.ok(!types.includes("LOW_COMPLETION:new"));
  assert.strictEqual(dashboard.alerts[0].severity, "HIGH");
  assert.strictEqual(dashboard.alerts.at(-1).severity, "MEDIUM");
  assert.strictEqual(dashboard.faculty[0].name, "Asha");
  assert.strictEqual(dashboard.departments[0].name, "Programming");
});

test("a struggling department is flagged below the original health threshold of 40", () => {
  const dashboard = admin.buildDashboard({
    platform: null,
    previousPlatform: null,
    courses: [course({ category: "Design", avgProgress: 5, avgEngagement: 5, atRiskLearners: 20, atRiskPercent: 100 })],
    instructorNames: new Map(),
    now: NOW,
  });
  assert.ok(dashboard.alerts.some((a) => a.type === "DEPARTMENT_DECLINE" && a.title.startsWith("Design")));
});
