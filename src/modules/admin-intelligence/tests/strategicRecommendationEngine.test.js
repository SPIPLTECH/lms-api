const test = require("node:test");
const assert = require("node:assert/strict");

const { buildStrategicRecommendations } = require("../services/domain/strategicRecommendationEngine");
const { RISK_SURGE_COUNT_THRESHOLD, STRATEGIC_RECOMMENDATION_CAP } = require("../constants");

const baseContext = (overrides = {}) => ({ highRiskStudents: [], ...overrides });

test("buildStrategicRecommendations generates STAFFING_CHANGE for an overloaded instructor", () => {
  const recs = buildStrategicRecommendations(baseContext(), {
    facultyAnalyticsList: [{ instructorId: "i1", overloadFlag: true, inactiveFlag: false, courseCount: 6 }],
    departmentAnalyticsList: [],
    capacityForecasts: [],
  });
  assert.ok(recs.some((r) => r.type === "STAFFING_CHANGE" && r.scopeId === "i1"));
});

test("buildStrategicRecommendations generates RISK_INTERVENTION only once the surge threshold is crossed", () => {
  const below = buildStrategicRecommendations(baseContext({ highRiskStudents: new Array(RISK_SURGE_COUNT_THRESHOLD - 1).fill({}) }), {
    facultyAnalyticsList: [],
    departmentAnalyticsList: [],
    capacityForecasts: [],
  });
  const above = buildStrategicRecommendations(baseContext({ highRiskStudents: new Array(RISK_SURGE_COUNT_THRESHOLD).fill({}) }), {
    facultyAnalyticsList: [],
    departmentAnalyticsList: [],
    capacityForecasts: [],
  });
  assert.ok(!below.some((r) => r.type === "RISK_INTERVENTION"));
  assert.ok(above.some((r) => r.type === "RISK_INTERVENTION"));
});

test("buildStrategicRecommendations generates CURRICULUM_UPDATE for a sharply declining department", () => {
  const recs = buildStrategicRecommendations(baseContext(), {
    facultyAnalyticsList: [],
    departmentAnalyticsList: [{ departmentKey: "Design", healthScore: 90, enrollmentTrendPercent: -50, averageCompletionRate: 90, atRiskStudentPercent: 5 }],
    capacityForecasts: [],
  });
  assert.ok(recs.some((r) => r.type === "CURRICULUM_UPDATE" && r.scopeId === "Design"));
});

test("buildStrategicRecommendations sorts by urgency*impact, highest first", () => {
  const recs = buildStrategicRecommendations(baseContext({ highRiskStudents: new Array(RISK_SURGE_COUNT_THRESHOLD).fill({}) }), {
    facultyAnalyticsList: [{ instructorId: "i1", overloadFlag: true, inactiveFlag: false, courseCount: 6 }],
    departmentAnalyticsList: [],
    capacityForecasts: [],
  });
  for (let i = 1; i < recs.length; i++) {
    assert.ok(recs[i - 1].urgency * recs[i - 1].impact >= recs[i].urgency * recs[i].impact);
  }
});

test("buildStrategicRecommendations caps the list at STRATEGIC_RECOMMENDATION_CAP", () => {
  const facultyAnalyticsList = Array.from({ length: STRATEGIC_RECOMMENDATION_CAP + 10 }, (_, i) => ({
    instructorId: `i${i}`,
    overloadFlag: true,
    inactiveFlag: false,
    courseCount: 6,
  }));
  const recs = buildStrategicRecommendations(baseContext(), { facultyAnalyticsList, departmentAnalyticsList: [], capacityForecasts: [] });
  assert.ok(recs.length <= STRATEGIC_RECOMMENDATION_CAP);
});
