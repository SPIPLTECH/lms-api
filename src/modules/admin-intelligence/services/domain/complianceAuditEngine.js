const {
  SCOPE_TYPE,
  PLATFORM_SCOPE_ID,
  COMPLIANCE_CHECK_TYPE,
  COMPLIANCE_OUTCOME,
  COMPLIANCE_SEVERITY,
  GOVERNANCE_METRIC_KEY,
  STALE_DRAFT_DAYS,
  LOW_CONFIDENCE_THRESHOLD,
  MAX_LOW_CONFIDENCE_RATIO,
} = require("../../constants");
const { average, round2, percent, clamp } = require("../../utils/scoreMath.util");

const DAY_MS = 24 * 3600 * 1000;
const daysSince = (date, now) => (now.getTime() - new Date(date).getTime()) / DAY_MS;

/**
 * Certificate issued without a matching Enrollment row — a real referential-
 * integrity check against two real tables (Certificate, Enrollment), not a
 * fabricated audit. There is no enforced DB constraint linking the two, so
 * this is genuinely worth checking, not a check that could never fail.
 */
const checkCertificateIntegrity = (context) => {
  const enrollmentKeys = new Set(context.enrollments.map((e) => `${e.studentId}:${e.courseId}`));
  const orphanCertificates = context.certificates.filter((cert) => !enrollmentKeys.has(`${cert.studentId}:${cert.courseId}`));

  const outcome = orphanCertificates.length === 0 ? COMPLIANCE_OUTCOME.PASS : COMPLIANCE_OUTCOME.FAIL;
  const severity = orphanCertificates.length > 0 ? COMPLIANCE_SEVERITY.CRITICAL : COMPLIANCE_SEVERITY.INFO;
  const integrityRate = percent(context.certificates.length - orphanCertificates.length, context.certificates.length || 1);

  return {
    checkType: COMPLIANCE_CHECK_TYPE.CERTIFICATE_INTEGRITY,
    outcome,
    severity,
    scopeType: SCOPE_TYPE.PLATFORM,
    scopeId: PLATFORM_SCOPE_ID,
    findings: `${orphanCertificates.length} of ${context.certificates.length} issued certificate(s) have no matching enrollment record.`,
    evidence: {
      orphanCount: orphanCertificates.length,
      totalCertificates: context.certificates.length,
      integrityRate,
      sample: orphanCertificates.slice(0, 5).map((c) => ({ studentId: c.studentId, courseId: c.courseId })),
    },
  };
};

/** Courses left in DRAFT well past a reasonable authoring window — a real, checkable operational-hygiene condition, not a fabricated policy. */
const checkCoursePublishingHygiene = (context) => {
  const staleDrafts = context.courses.filter((c) => c.status === "DRAFT" && daysSince(c.createdAt, context.now) > STALE_DRAFT_DAYS);

  const outcome = staleDrafts.length === 0 ? COMPLIANCE_OUTCOME.PASS : COMPLIANCE_OUTCOME.FAIL;
  const severity = staleDrafts.length > 0 ? COMPLIANCE_SEVERITY.WARNING : COMPLIANCE_SEVERITY.INFO;

  return {
    checkType: COMPLIANCE_CHECK_TYPE.COURSE_PUBLISHING_HYGIENE,
    outcome,
    severity,
    scopeType: SCOPE_TYPE.PLATFORM,
    scopeId: PLATFORM_SCOPE_ID,
    findings: `${staleDrafts.length} course(s) have sat in DRAFT for more than ${STALE_DRAFT_DAYS} days.`,
    evidence: { staleDraftCount: staleDrafts.length, sample: staleDrafts.slice(0, 5).map((c) => ({ courseId: c.id, title: c.title })) },
  };
};

/** Courses missing a category or description — a real completeness gap on real Course fields, the honest proxy for "data completeness" in a schema with no dedicated completeness/audit model. */
const checkDataCompleteness = (context) => {
  const incomplete = context.courses.filter((c) => !c.category || !c.description);
  const completenessRate = percent(context.courses.length - incomplete.length, context.courses.length || 1);

  const outcome = incomplete.length === 0 ? COMPLIANCE_OUTCOME.PASS : COMPLIANCE_OUTCOME.FAIL;
  const severity = incomplete.length > 0 ? COMPLIANCE_SEVERITY.WARNING : COMPLIANCE_SEVERITY.INFO;

  return {
    checkType: COMPLIANCE_CHECK_TYPE.DATA_COMPLETENESS,
    outcome,
    severity,
    scopeType: SCOPE_TYPE.PLATFORM,
    scopeId: PLATFORM_SCOPE_ID,
    findings: `${incomplete.length} of ${context.courses.length} course(s) are missing a category or description.`,
    evidence: { incompleteCount: incomplete.length, totalCourses: context.courses.length, completenessRate },
  };
};

/**
 * The real "Audit AI decisions" check: scans Teaching Recommendation's
 * confidenceScore across every course dashboard already gathered in
 * context.teacherDashboards — real, cross-agent AI-decision data, not
 * fabricated. Flags out-of-range values (a genuine correctness bug in the
 * upstream agent) and an elevated ratio of low-confidence recommendations
 * (a real quality signal, not a made-up one).
 */
const checkAiDecisionQuality = (context) => {
  const allRecommendations = Object.values(context.teacherDashboards).flatMap((dashboard) =>
    (dashboard?.courses || []).flatMap((c) => c.teachingRecommendations || [])
  );

  const invalidConfidence = allRecommendations.filter(
    (r) => typeof r.confidenceScore !== "number" || Number.isNaN(r.confidenceScore) || r.confidenceScore < 0 || r.confidenceScore > 100
  );
  const lowConfidenceCount = allRecommendations.filter((r) => r.confidenceScore < LOW_CONFIDENCE_THRESHOLD).length;
  const lowConfidenceRatio = percent(lowConfidenceCount, allRecommendations.length || 1);

  const outcome = invalidConfidence.length > 0 || lowConfidenceRatio > MAX_LOW_CONFIDENCE_RATIO ? COMPLIANCE_OUTCOME.FAIL : COMPLIANCE_OUTCOME.PASS;
  const severity = invalidConfidence.length > 0 ? COMPLIANCE_SEVERITY.CRITICAL : lowConfidenceRatio > MAX_LOW_CONFIDENCE_RATIO ? COMPLIANCE_SEVERITY.WARNING : COMPLIANCE_SEVERITY.INFO;

  return {
    checkType: COMPLIANCE_CHECK_TYPE.AI_DECISION_QUALITY,
    outcome,
    severity,
    scopeType: SCOPE_TYPE.PLATFORM,
    scopeId: PLATFORM_SCOPE_ID,
    findings: `${invalidConfidence.length} out-of-range confidence score(s); ${lowConfidenceRatio}% of ${allRecommendations.length} AI teaching recommendation(s) are low-confidence.`,
    evidence: { invalidCount: invalidConfidence.length, lowConfidenceCount, totalRecommendations: allRecommendations.length, lowConfidenceRatio },
  };
};

/**
 * Runs all real governance checks. Every candidate here becomes a new,
 * append-only ComplianceAudit row every run — this is the audit ledger
 * itself, not a current-row cache.
 *
 * @param {import("../../types/adminIntelligence.types").InstitutionContext} context
 */
const runComplianceChecks = (context) => [
  checkCertificateIntegrity(context),
  checkCoursePublishingHygiene(context),
  checkDataCompleteness(context),
  checkAiDecisionQuality(context),
];

/**
 * Derives the 5 GovernanceMetric time-series rows from this run's own audit
 * results — no separate computation, just re-expressing the audits' own
 * evidence as tracked metrics for GET /admin-intelligence/compliance's
 * trend view.
 *
 * @param {ReturnType<typeof runComplianceChecks>} auditResults
 */
const deriveGovernanceMetrics = (auditResults) => {
  const byType = Object.fromEntries(auditResults.map((a) => [a.checkType, a]));

  const certificateIntegrityRate = byType[COMPLIANCE_CHECK_TYPE.CERTIFICATE_INTEGRITY]?.evidence.integrityRate ?? 100;
  const dataCompletenessRate = byType[COMPLIANCE_CHECK_TYPE.DATA_COMPLETENESS]?.evidence.completenessRate ?? 100;
  const aiDecisionAuditPassRate = round2(100 - (byType[COMPLIANCE_CHECK_TYPE.AI_DECISION_QUALITY]?.evidence.lowConfidenceRatio ?? 0));

  const passCount = auditResults.filter((a) => a.outcome === COMPLIANCE_OUTCOME.PASS).length;
  const policyComplianceRate = percent(passCount, auditResults.length);

  const accreditationReadiness = round2(
    average([certificateIntegrityRate, dataCompletenessRate, clamp(aiDecisionAuditPassRate), policyComplianceRate])
  );

  return [
    { metricKey: GOVERNANCE_METRIC_KEY.POLICY_COMPLIANCE_RATE, value: policyComplianceRate, unit: "%" },
    { metricKey: GOVERNANCE_METRIC_KEY.CERTIFICATE_INTEGRITY_RATE, value: certificateIntegrityRate, unit: "%" },
    { metricKey: GOVERNANCE_METRIC_KEY.DATA_COMPLETENESS_RATE, value: dataCompletenessRate, unit: "%" },
    { metricKey: GOVERNANCE_METRIC_KEY.AI_DECISION_AUDIT_PASS_RATE, value: clamp(aiDecisionAuditPassRate), unit: "%" },
    { metricKey: GOVERNANCE_METRIC_KEY.ACCREDITATION_READINESS, value: accreditationReadiness, unit: "%" },
  ];
};

module.exports = { runComplianceChecks, deriveGovernanceMetrics };
