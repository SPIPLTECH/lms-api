const test = require("node:test");
const assert = require("node:assert/strict");

const { calculateInstitutionHealth } = require("../services/domain/healthScoreEngine");

const baseContext = (overrides = {}) => ({
  now: new Date(),
  platformSnapshot: {
    kpis: [
      { metricKey: "AI_USAGE", value: 50 },
      { metricKey: "RETENTION", value: 80 },
      { metricKey: "CHURN", value: 10 },
      { metricKey: "REVENUE_READY", value: 1000 },
      { metricKey: "ACTIVE_USERS", value: 100 },
    ],
  },
  courses: [{ id: "c1", status: "PUBLISHED", creatorId: "i1" }],
  enrollments: [],
  ...overrides,
});

test("calculateInstitutionHealth reuses Analytics' own PLATFORM KPI values as-is, not re-derived", () => {
  const health = calculateInstitutionHealth(baseContext(), { facultyAnalyticsList: [], departmentAnalyticsList: [] });
  assert.equal(health.aiAdoptionScore, 50);
  assert.equal(health.retentionRate, 80);
  assert.equal(health.churnRate, 10);
  assert.equal(health.revenueEstimate, 1000);
  assert.equal(health.activeStudentCount, 100);
});

test("calculateInstitutionHealth falls back to 0 for a missing platform KPI rather than throwing", () => {
  const context = baseContext({ platformSnapshot: { kpis: [] } });
  const health = calculateInstitutionHealth(context, { facultyAnalyticsList: [], departmentAnalyticsList: [] });
  assert.equal(health.aiAdoptionScore, 0);
});

test("calculateInstitutionHealth averages facultyAnalyticsList's real performanceScore, not a re-derivation", () => {
  const health = calculateInstitutionHealth(baseContext(), {
    facultyAnalyticsList: [{ performanceScore: 60 }, { performanceScore: 80 }],
    departmentAnalyticsList: [],
  });
  assert.equal(health.facultyPerformanceScore, 70);
});

test("calculateInstitutionHealth counts only non-ARCHIVED courses toward activeInstructorCount", () => {
  const context = baseContext({
    courses: [
      { id: "c1", status: "PUBLISHED", creatorId: "i1" },
      { id: "c2", status: "ARCHIVED", creatorId: "i2" },
    ],
  });
  const health = calculateInstitutionHealth(context, { facultyAnalyticsList: [], departmentAnalyticsList: [] });
  assert.equal(health.activeInstructorCount, 1);
});

test("calculateInstitutionHealth keeps lmsHealthScore within [0, 100]", () => {
  const health = calculateInstitutionHealth(baseContext(), {
    facultyAnalyticsList: [{ performanceScore: 100 }],
    departmentAnalyticsList: [{ averageCompletionRate: 100, atRiskStudentPercent: 0, averageCourseHealthScore: 100 }],
  });
  assert.ok(health.lmsHealthScore >= 0 && health.lmsHealthScore <= 100);
});
