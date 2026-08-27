const {
  SCOPE_TYPE,
  PLATFORM_SCOPE_ID,
  ALERT_TYPE,
  ALERT_PRIORITY,
  DEPARTMENT_HEALTH_ALERT_THRESHOLD,
  RISK_SURGE_COUNT_THRESHOLD,
  CAPACITY_WARNING_ENROLLMENT_PER_INSTRUCTOR,
  CAPACITY_RESOURCE_TYPE,
  COMPLIANCE_OUTCOME,
  COMPLIANCE_SEVERITY,
} = require("../../constants");
const { buildDedupeKey } = require("../../utils/dedupeKey.util");

/**
 * Operational, "flag it now" alerts — distinct from StrategicRecommendation
 * ("here's what to do about it"). Reuses the exact same real signals
 * (facultyAnalyticsList/departmentAnalyticsList/complianceAudit results/
 * capacityForecasts/highRiskStudents), just at stricter thresholds and a
 * different output shape, matching the spec's separate "High Priority
 * Alerts" vs "Strategic Recommendations" Executive outputs.
 *
 * @param {import("../../types/adminIntelligence.types").InstitutionContext} context
 * @param {{facultyAnalyticsList: object[], departmentAnalyticsList: object[], complianceAuditResults: object[], capacityForecasts: object[]}} derived
 */
const buildAdminAlerts = (context, { facultyAnalyticsList, departmentAnalyticsList, complianceAuditResults, capacityForecasts }) => {
  const alerts = [];

  for (const faculty of facultyAnalyticsList) {
    if (faculty.overloadFlag) {
      alerts.push({
        scopeType: SCOPE_TYPE.FACULTY,
        scopeId: faculty.instructorId,
        alertType: ALERT_TYPE.INSTRUCTOR_OVERLOAD,
        priority: ALERT_PRIORITY.MEDIUM,
        dedupeKey: buildDedupeKey("INSTRUCTOR_OVERLOAD", faculty.instructorId),
        reason: `Teaching ${faculty.courseCount} concurrent course(s).`,
        evidence: { courseCount: faculty.courseCount },
      });
    }
    if (faculty.inactiveFlag) {
      alerts.push({
        scopeType: SCOPE_TYPE.FACULTY,
        scopeId: faculty.instructorId,
        alertType: ALERT_TYPE.INACTIVE_INSTRUCTOR,
        priority: ALERT_PRIORITY.MEDIUM,
        dedupeKey: buildDedupeKey("INACTIVE_INSTRUCTOR", faculty.instructorId),
        reason: "No active student engagement detected across any owned course.",
        evidence: { activeStudentCount: faculty.activeStudentCount },
      });
    }
  }

  for (const dept of departmentAnalyticsList) {
    if (dept.healthScore < DEPARTMENT_HEALTH_ALERT_THRESHOLD) {
      alerts.push({
        scopeType: SCOPE_TYPE.DEPARTMENT,
        scopeId: dept.departmentKey,
        alertType: ALERT_TYPE.DEPARTMENT_DECLINE,
        priority: ALERT_PRIORITY.HIGH,
        dedupeKey: buildDedupeKey("DEPARTMENT_DECLINE", dept.departmentKey),
        reason: `Health score has dropped to ${dept.healthScore} (critical threshold ${DEPARTMENT_HEALTH_ALERT_THRESHOLD}).`,
        evidence: { healthScore: dept.healthScore },
      });
    }
  }

  for (const audit of complianceAuditResults) {
    if (audit.outcome === COMPLIANCE_OUTCOME.FAIL && audit.severity === COMPLIANCE_SEVERITY.CRITICAL) {
      alerts.push({
        scopeType: audit.scopeType,
        scopeId: audit.scopeId,
        alertType: ALERT_TYPE.COMPLIANCE_FAILURE,
        priority: ALERT_PRIORITY.HIGH,
        dedupeKey: buildDedupeKey("COMPLIANCE_FAILURE", audit.checkType, audit.scopeId),
        reason: audit.findings,
        evidence: audit.evidence,
      });
    }
  }

  if (context.highRiskStudents.length >= RISK_SURGE_COUNT_THRESHOLD) {
    alerts.push({
      scopeType: SCOPE_TYPE.PLATFORM,
      scopeId: PLATFORM_SCOPE_ID,
      alertType: ALERT_TYPE.HIGH_RISK_SURGE,
      priority: ALERT_PRIORITY.HIGH,
      dedupeKey: buildDedupeKey("HIGH_RISK_SURGE", "PLATFORM"),
      reason: `${context.highRiskStudents.length} student(s) are currently at HIGH dropout risk.`,
      evidence: { highRiskCount: context.highRiskStudents.length },
    });
  }

  for (const forecast of capacityForecasts) {
    if (forecast.resourceType === CAPACITY_RESOURCE_TYPE.INSTRUCTOR_CAPACITY && forecast.predictedValue > CAPACITY_WARNING_ENROLLMENT_PER_INSTRUCTOR) {
      alerts.push({
        scopeType: SCOPE_TYPE.PLATFORM,
        scopeId: PLATFORM_SCOPE_ID,
        alertType: ALERT_TYPE.CAPACITY_WARNING,
        priority: ALERT_PRIORITY.MEDIUM,
        dedupeKey: buildDedupeKey("CAPACITY_WARNING", forecast.resourceType),
        reason: `Projected ${forecast.predictedValue} students per instructor by ${new Date(forecast.forecastDate).toISOString().slice(0, 10)}.`,
        evidence: { predictedValue: forecast.predictedValue },
      });
    }
  }

  return alerts;
};

module.exports = { buildAdminAlerts };
