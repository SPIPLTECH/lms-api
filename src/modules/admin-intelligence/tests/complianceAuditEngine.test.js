const test = require("node:test");
const assert = require("node:assert/strict");

const { runComplianceChecks, deriveGovernanceMetrics } = require("../services/domain/complianceAuditEngine");

const baseContext = (overrides = {}) => ({
  now: new Date(),
  courses: [],
  enrollments: [],
  certificates: [],
  teacherDashboards: {},
  ...overrides,
});

test("CERTIFICATE_INTEGRITY passes when every certificate has a matching enrollment", () => {
  const context = baseContext({
    enrollments: [{ studentId: "s1", courseId: "c1" }],
    certificates: [{ studentId: "s1", courseId: "c1" }],
  });
  const [certCheck] = runComplianceChecks(context);
  assert.equal(certCheck.outcome, "PASS");
});

test("CERTIFICATE_INTEGRITY fails on an orphan certificate (no matching enrollment)", () => {
  const context = baseContext({
    enrollments: [],
    certificates: [{ studentId: "ghost", courseId: "c1" }],
  });
  const [certCheck] = runComplianceChecks(context);
  assert.equal(certCheck.outcome, "FAIL");
  assert.equal(certCheck.severity, "CRITICAL");
  assert.equal(certCheck.evidence.orphanCount, 1);
});

test("COURSE_PUBLISHING_HYGIENE flags a DRAFT course older than STALE_DRAFT_DAYS", () => {
  const day = 24 * 3600 * 1000;
  const context = baseContext({
    courses: [{ id: "c1", status: "DRAFT", createdAt: new Date(Date.now() - 40 * day), category: "X", description: "d" }],
  });
  const [, hygieneCheck] = runComplianceChecks(context);
  assert.equal(hygieneCheck.outcome, "FAIL");
  assert.equal(hygieneCheck.evidence.staleDraftCount, 1);
});

test("COURSE_PUBLISHING_HYGIENE ignores a recent DRAFT course", () => {
  const context = baseContext({ courses: [{ id: "c1", status: "DRAFT", createdAt: new Date(), category: "X", description: "d" }] });
  const [, hygieneCheck] = runComplianceChecks(context);
  assert.equal(hygieneCheck.outcome, "PASS");
});

test("DATA_COMPLETENESS flags a course missing category or description", () => {
  const context = baseContext({ courses: [{ id: "c1", status: "PUBLISHED", createdAt: new Date(), category: null, description: "d" }] });
  const [, , completenessCheck] = runComplianceChecks(context);
  assert.equal(completenessCheck.outcome, "FAIL");
  assert.equal(completenessCheck.evidence.incompleteCount, 1);
});

test("AI_DECISION_QUALITY fails on an out-of-range confidence score", () => {
  const context = baseContext({
    teacherDashboards: { i1: { courses: [{ teachingRecommendations: [{ confidenceScore: 150 }] }] } },
  });
  const [, , , aiCheck] = runComplianceChecks(context);
  assert.equal(aiCheck.outcome, "FAIL");
  assert.equal(aiCheck.severity, "CRITICAL");
});

test("AI_DECISION_QUALITY passes when confidence scores are valid and mostly high", () => {
  const context = baseContext({
    teacherDashboards: { i1: { courses: [{ teachingRecommendations: [{ confidenceScore: 90 }, { confidenceScore: 85 }] }] } },
  });
  const [, , , aiCheck] = runComplianceChecks(context);
  assert.equal(aiCheck.outcome, "PASS");
});

test("deriveGovernanceMetrics computes ACCREDITATION_READINESS from the same run's audit evidence", () => {
  const context = baseContext({
    enrollments: [{ studentId: "s1", courseId: "c1" }],
    certificates: [{ studentId: "s1", courseId: "c1" }],
    courses: [{ id: "c1", status: "PUBLISHED", createdAt: new Date(), category: "X", description: "d" }],
  });
  const results = runComplianceChecks(context);
  const metrics = deriveGovernanceMetrics(results);
  const accreditation = metrics.find((m) => m.metricKey === "ACCREDITATION_READINESS");
  assert.equal(accreditation.value, 100); // everything real and clean -> full readiness
});
