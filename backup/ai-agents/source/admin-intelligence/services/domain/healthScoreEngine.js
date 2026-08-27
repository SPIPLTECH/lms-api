const {
  HEALTH_WEIGHT_ACADEMIC,
  HEALTH_WEIGHT_FACULTY,
  HEALTH_WEIGHT_AI_ADOPTION,
  HEALTH_WEIGHT_RETENTION,
  HEALTH_WEIGHT_CHURN,
} = require("../../constants");
const { average, round2, clamp } = require("../../utils/scoreMath.util");
const { computeEnrollmentGrowthPercent } = require("../../utils/growth.util");

const platformKpiValue = (platformSnapshot, metricKey, fallback = 0) => {
  const kpi = (platformSnapshot?.kpis || []).find((k) => k.metricKey === metricKey);
  return typeof kpi?.value === "number" ? kpi.value : fallback;
};

/**
 * Institution-wide health composite. Directly reuses Analytics' own already-
 * computed PLATFORM-scope KPIs for AI_USAGE/RETENTION/CHURN/REVENUE_READY
 * (no re-derivation), and Teacher Insight's real per-course CourseHealth for
 * the academic side (via departmentAnalyticsList, itself built from the
 * same real CourseHealth rows). facultyPerformanceScore is the average of
 * facultyAnalyticsList's own real per-instructor performanceScore.
 *
 * @param {import("../../types/adminIntelligence.types").InstitutionContext} context
 * @param {{facultyAnalyticsList: object[], departmentAnalyticsList: object[]}} derived
 */
const calculateInstitutionHealth = (context, { facultyAnalyticsList, departmentAnalyticsList }) => {
  const { platformSnapshot, courses, enrollments } = context;

  const aiAdoptionScore = round2(clamp(platformKpiValue(platformSnapshot, "AI_USAGE")));
  const retentionRate = round2(clamp(platformKpiValue(platformSnapshot, "RETENTION")));
  const churnRate = round2(clamp(platformKpiValue(platformSnapshot, "CHURN")));
  const revenueEstimate = round2(platformKpiValue(platformSnapshot, "REVENUE_READY"));
  // ACTIVE_USERS is Analytics' own weekly-active proxy, inherited honestly rather than re-labeled as something more precise.
  const activeStudentCount = Math.round(platformKpiValue(platformSnapshot, "ACTIVE_USERS"));

  const activeInstructorCount = new Set(courses.filter((c) => c.status !== "ARCHIVED").map((c) => c.creatorId)).size;
  const totalEnrollmentCount = enrollments.length;
  const platformGrowthRate = computeEnrollmentGrowthPercent(enrollments, context.now);

  const completionRate = round2(average(departmentAnalyticsList.map((d) => d.averageCompletionRate)));
  const atRiskPercent = round2(average(departmentAnalyticsList.map((d) => d.atRiskStudentPercent)));
  const studentSuccessRate = round2(clamp(100 - atRiskPercent));
  const academicHealthScore = round2(
    average([completionRate, studentSuccessRate, average(departmentAnalyticsList.map((d) => d.averageCourseHealthScore))])
  );

  const facultyPerformanceScore = round2(average(facultyAnalyticsList.map((f) => f.performanceScore)));

  const lmsHealthScore = round2(
    clamp(
      academicHealthScore * HEALTH_WEIGHT_ACADEMIC +
        facultyPerformanceScore * HEALTH_WEIGHT_FACULTY +
        aiAdoptionScore * HEALTH_WEIGHT_AI_ADOPTION +
        retentionRate * HEALTH_WEIGHT_RETENTION +
        clamp(100 - churnRate) * HEALTH_WEIGHT_CHURN
    )
  );

  return {
    lmsHealthScore,
    academicHealthScore,
    facultyPerformanceScore,
    studentSuccessRate,
    completionRate,
    aiAdoptionScore,
    retentionRate,
    churnRate,
    revenueEstimate,
    platformGrowthRate,
    activeStudentCount,
    activeInstructorCount,
    totalEnrollmentCount,
  };
};

module.exports = { calculateInstitutionHealth };
