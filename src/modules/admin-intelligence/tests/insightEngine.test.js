const test = require("node:test");
const assert = require("node:assert/strict");

const { buildAdminInsights } = require("../services/domain/insightEngine");

const institutionHealth = {
  academicHealthScore: 70,
  completionRate: 65,
  studentSuccessRate: 80,
  facultyPerformanceScore: 75,
  activeInstructorCount: 5,
  revenueEstimate: 10000,
  activeStudentCount: 50,
  retentionRate: 60,
  churnRate: 20,
  platformGrowthRate: 5,
  aiAdoptionScore: 40,
};

test("buildAdminInsights always produces the 6 fixed platform-scoped category insights", () => {
  const insights = buildAdminInsights({ highRiskStudents: [] }, { institutionHealth, departmentAnalyticsList: [], governanceMetrics: [] });
  const categories = new Set(insights.filter((i) => i.scopeType === "PLATFORM" && i.dedupeKey.startsWith("PLATFORM:")).map((i) => i.category));
  assert.ok(categories.has("ACADEMIC"));
  assert.ok(categories.has("OPERATIONAL"));
  assert.ok(categories.has("FINANCIAL"));
  assert.ok(categories.has("ENGAGEMENT"));
  assert.ok(categories.has("AI_ADOPTION"));
  assert.ok(categories.has("RISK"));
});

test("buildAdminInsights adds at most ADMIN_INSIGHT_DEPARTMENT_CALLOUT_COUNT department callouts", () => {
  const departmentAnalyticsList = Array.from({ length: 10 }, (_, i) => ({ departmentKey: `D${i}`, healthScore: i * 10, courseCount: 1 }));
  const insights = buildAdminInsights({ highRiskStudents: [] }, { institutionHealth, departmentAnalyticsList, governanceMetrics: [] });
  const departmentInsights = insights.filter((i) => i.scopeType === "DEPARTMENT");
  assert.ok(departmentInsights.length <= 3);
});

test("buildAdminInsights includes an accreditation insight when governanceMetrics has ACCREDITATION_READINESS", () => {
  const insights = buildAdminInsights(
    { highRiskStudents: [] },
    { institutionHealth, departmentAnalyticsList: [], governanceMetrics: [{ metricKey: "ACCREDITATION_READINESS", value: 55 }] }
  );
  const accreditationInsight = insights.find((i) => i.dedupeKey === "PLATFORM:ACCREDITATION");
  assert.ok(accreditationInsight);
  assert.equal(accreditationInsight.priority, "HIGH"); // below 70 -> HIGH
});

test("buildAdminInsights omits the accreditation insight when governanceMetrics is empty", () => {
  const insights = buildAdminInsights({ highRiskStudents: [] }, { institutionHealth, departmentAnalyticsList: [], governanceMetrics: [] });
  assert.ok(!insights.some((i) => i.dedupeKey === "PLATFORM:ACCREDITATION"));
});

test("buildAdminInsights every insight carries a unique dedupeKey", () => {
  const departmentAnalyticsList = [{ departmentKey: "D1", healthScore: 40, courseCount: 1 }];
  const insights = buildAdminInsights(
    { highRiskStudents: [] },
    { institutionHealth, departmentAnalyticsList, governanceMetrics: [{ metricKey: "ACCREDITATION_READINESS", value: 90 }] }
  );
  const keys = insights.map((i) => i.dedupeKey);
  assert.equal(new Set(keys).size, keys.length);
});
