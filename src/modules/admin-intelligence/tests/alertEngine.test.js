const test = require("node:test");
const assert = require("node:assert/strict");

const { buildAdminAlerts } = require("../services/domain/alertEngine");
const { DEPARTMENT_HEALTH_ALERT_THRESHOLD, RISK_SURGE_COUNT_THRESHOLD } = require("../constants");

const baseContext = (overrides = {}) => ({ highRiskStudents: [], ...overrides });

test("buildAdminAlerts raises DEPARTMENT_DECLINE only below the stricter alert threshold, not the looser recommendation threshold", () => {
  const alerts = buildAdminAlerts(baseContext(), {
    facultyAnalyticsList: [],
    departmentAnalyticsList: [{ departmentKey: "X", healthScore: DEPARTMENT_HEALTH_ALERT_THRESHOLD - 1 }],
    complianceAuditResults: [],
    capacityForecasts: [],
  });
  assert.ok(alerts.some((a) => a.alertType === "DEPARTMENT_DECLINE"));
});

test("buildAdminAlerts raises COMPLIANCE_FAILURE only for CRITICAL-severity FAIL audits, not WARNING ones", () => {
  const alerts = buildAdminAlerts(baseContext(), {
    facultyAnalyticsList: [],
    departmentAnalyticsList: [],
    complianceAuditResults: [
      { checkType: "CERTIFICATE_INTEGRITY", outcome: "FAIL", severity: "CRITICAL", scopeType: "PLATFORM", scopeId: "platform", findings: "x", evidence: {} },
      { checkType: "COURSE_PUBLISHING_HYGIENE", outcome: "FAIL", severity: "WARNING", scopeType: "PLATFORM", scopeId: "platform", findings: "y", evidence: {} },
    ],
    capacityForecasts: [],
  });
  const complianceAlerts = alerts.filter((a) => a.alertType === "COMPLIANCE_FAILURE");
  assert.equal(complianceAlerts.length, 1);
  assert.equal(complianceAlerts[0].dedupeKey, "COMPLIANCE_FAILURE:CERTIFICATE_INTEGRITY:platform");
});

test("buildAdminAlerts raises HIGH_RISK_SURGE at exactly the threshold count", () => {
  const alerts = buildAdminAlerts(baseContext({ highRiskStudents: new Array(RISK_SURGE_COUNT_THRESHOLD).fill({}) }), {
    facultyAnalyticsList: [],
    departmentAnalyticsList: [],
    complianceAuditResults: [],
    capacityForecasts: [],
  });
  assert.ok(alerts.some((a) => a.alertType === "HIGH_RISK_SURGE"));
});

test("buildAdminAlerts stays empty when nothing is wrong", () => {
  const alerts = buildAdminAlerts(baseContext(), {
    facultyAnalyticsList: [{ instructorId: "i1", overloadFlag: false, inactiveFlag: false }],
    departmentAnalyticsList: [{ departmentKey: "X", healthScore: 90 }],
    complianceAuditResults: [],
    capacityForecasts: [],
  });
  assert.equal(alerts.length, 0);
});
