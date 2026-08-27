const { SCOPE_TYPE, PLATFORM_SCOPE_ID, INSIGHT_CATEGORY, ADMIN_INSIGHT_DEPARTMENT_CALLOUT_COUNT } = require("../../constants");
const { buildDedupeKey } = require("../../utils/dedupeKey.util");

/**
 * 6 fixed platform-scoped insights (one per category, deterministic — a
 * category either has a real number to report or it doesn't) plus up to
 * ADMIN_INSIGHT_DEPARTMENT_CALLOUT_COUNT department callouts (best/worst by
 * healthScore, real data from departmentAggregator) — deliberately not a
 * competing-candidates/ranked pipeline like StrategicRecommendation: these
 * are observational statements about current state, not actions to choose
 * between, so a fixed, small set is honest rather than under-populated.
 *
 * @param {import("../../types/adminIntelligence.types").InstitutionContext} context
 * @param {{institutionHealth: object, departmentAnalyticsList: object[], governanceMetrics: object[]}} derived
 */
const buildAdminInsights = (context, { institutionHealth, departmentAnalyticsList, governanceMetrics }) => {
  const insights = [
    {
      category: INSIGHT_CATEGORY.ACADEMIC,
      title: "Academic health",
      summary: `Academic health score is ${institutionHealth.academicHealthScore}, with a ${institutionHealth.completionRate}% average completion rate and ${institutionHealth.studentSuccessRate}% student success rate.`,
      confidenceScore: 75,
    },
    {
      category: INSIGHT_CATEGORY.OPERATIONAL,
      title: "Faculty performance",
      summary: `Faculty performance score is ${institutionHealth.facultyPerformanceScore}, across ${institutionHealth.activeInstructorCount} active instructor(s).`,
      confidenceScore: 70,
    },
    {
      category: INSIGHT_CATEGORY.FINANCIAL,
      title: "Revenue trend",
      summary: `Attributed revenue estimate is ${institutionHealth.revenueEstimate} (enrollment x course price — not real billing data, no payment gateway is integrated in this LMS).`,
      confidenceScore: 50,
    },
    {
      category: INSIGHT_CATEGORY.ENGAGEMENT,
      title: "Platform engagement",
      summary: `${institutionHealth.activeStudentCount} active student(s), ${institutionHealth.retentionRate}% retention, ${institutionHealth.churnRate}% churn, ${institutionHealth.platformGrowthRate}% enrollment growth.`,
      confidenceScore: 70,
    },
    {
      category: INSIGHT_CATEGORY.AI_ADOPTION,
      title: "AI adoption",
      summary: `AI adoption score is ${institutionHealth.aiAdoptionScore}, based on AI-assisted feature usage across the platform.`,
      confidenceScore: 65,
    },
    {
      category: INSIGHT_CATEGORY.RISK,
      title: "Institution-wide risk",
      summary: `${context.highRiskStudents.length} student(s) are currently at elevated dropout risk.`,
      confidenceScore: 75,
    },
  ].map((insight) => ({
    ...insight,
    scopeType: SCOPE_TYPE.PLATFORM,
    scopeId: PLATFORM_SCOPE_ID,
    dedupeKey: buildDedupeKey("PLATFORM", insight.category),
    priority: "MEDIUM",
    evidence: null,
  }));

  const sortedByHealth = [...departmentAnalyticsList].sort((a, b) => b.healthScore - a.healthScore);
  const callouts = [...sortedByHealth.slice(0, 1), ...sortedByHealth.slice(-1)]
    .filter((d, index, arr) => arr.findIndex((x) => x.departmentKey === d.departmentKey) === index)
    .slice(0, ADMIN_INSIGHT_DEPARTMENT_CALLOUT_COUNT);

  for (const dept of callouts) {
    insights.push({
      category: INSIGHT_CATEGORY.ACADEMIC,
      title: `${dept.departmentKey} department health`,
      summary: `${dept.departmentKey} has a health score of ${dept.healthScore} across ${dept.courseCount} course(s).`,
      confidenceScore: 65,
      scopeType: SCOPE_TYPE.DEPARTMENT,
      scopeId: dept.departmentKey,
      dedupeKey: buildDedupeKey("DEPARTMENT", dept.departmentKey),
      priority: dept.healthScore < 50 ? "HIGH" : "LOW",
      evidence: { healthScore: dept.healthScore },
    });
  }

  // Governance/accreditation summary — folds in the compliance-derived metrics from this same run.
  const accreditation = governanceMetrics.find((m) => m.metricKey === "ACCREDITATION_READINESS");
  if (accreditation) {
    insights.push({
      category: INSIGHT_CATEGORY.OPERATIONAL,
      title: "Accreditation readiness",
      summary: `Accreditation readiness is ${accreditation.value}%, based on certificate integrity, data completeness, AI decision quality, and overall policy compliance.`,
      confidenceScore: 60,
      scopeType: SCOPE_TYPE.PLATFORM,
      scopeId: PLATFORM_SCOPE_ID,
      dedupeKey: buildDedupeKey("PLATFORM", "ACCREDITATION"),
      priority: accreditation.value < 70 ? "HIGH" : "LOW",
      evidence: { accreditationReadiness: accreditation.value },
    });
  }

  return insights;
};

module.exports = { buildAdminInsights };
