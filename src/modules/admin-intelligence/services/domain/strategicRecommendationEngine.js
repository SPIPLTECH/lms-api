const {
  SCOPE_TYPE,
  PLATFORM_SCOPE_ID,
  RECOMMENDATION_TYPE,
  DEPARTMENT_HEALTH_RECOMMEND_THRESHOLD,
  DEPARTMENT_DECLINE_TREND_PERCENT,
  RISK_SURGE_COUNT_THRESHOLD,
  CAPACITY_WARNING_ENROLLMENT_PER_INSTRUCTOR,
  CAPACITY_RESOURCE_TYPE,
  STRATEGIC_RECOMMENDATION_CAP,
} = require("../../constants");
const { buildDedupeKey } = require("../../utils/dedupeKey.util");

/** Overloaded/inactive instructors -> STAFFING_CHANGE. Real, from facultyAggregator's own flags. */
const generateStaffingRecommendations = (facultyAnalyticsList) => {
  const candidates = [];
  for (const faculty of facultyAnalyticsList) {
    if (faculty.overloadFlag) {
      candidates.push({
        type: RECOMMENDATION_TYPE.STAFFING_CHANGE,
        scopeType: SCOPE_TYPE.FACULTY,
        scopeId: faculty.instructorId,
        dedupeKey: buildDedupeKey("STAFFING", "OVERLOAD", faculty.instructorId),
        title: "Instructor is teaching an overloaded course count",
        reason: `Teaching ${faculty.courseCount} concurrent course(s) — consider redistributing load or hiring additional faculty.`,
        urgency: 70,
        impact: 60,
        confidenceScore: 80,
        evidence: { courseCount: faculty.courseCount },
      });
    }
    if (faculty.inactiveFlag) {
      candidates.push({
        type: RECOMMENDATION_TYPE.STAFFING_CHANGE,
        scopeType: SCOPE_TYPE.FACULTY,
        scopeId: faculty.instructorId,
        dedupeKey: buildDedupeKey("STAFFING", "INACTIVE", faculty.instructorId),
        title: "Instructor shows no active student engagement",
        reason: "No active students across any owned course, or the instructor's account is not ACTIVE — review staffing status.",
        urgency: 60,
        impact: 50,
        confidenceScore: 75,
        evidence: { courseCount: faculty.courseCount, activeStudentCount: faculty.activeStudentCount },
      });
    }
  }
  return candidates;
};

/** Low-health departments -> COURSE_IMPROVEMENT. Real, from departmentAggregator's real CourseHealth-derived healthScore. */
const generateCourseImprovementRecommendations = (departmentAnalyticsList) =>
  departmentAnalyticsList
    .filter((d) => d.healthScore < DEPARTMENT_HEALTH_RECOMMEND_THRESHOLD)
    .map((d) => ({
      type: RECOMMENDATION_TYPE.COURSE_IMPROVEMENT,
      scopeType: SCOPE_TYPE.DEPARTMENT,
      scopeId: d.departmentKey,
      dedupeKey: buildDedupeKey("COURSE_IMPROVEMENT", d.departmentKey),
      title: `${d.departmentKey} department's courses need attention`,
      reason: `Health score is ${d.healthScore} (below ${DEPARTMENT_HEALTH_RECOMMEND_THRESHOLD}) — completion rate ${d.averageCompletionRate}%, ${d.atRiskStudentPercent}% of students at risk.`,
      urgency: Math.round(100 - d.healthScore),
      impact: 65,
      confidenceScore: 70,
      evidence: { healthScore: d.healthScore, averageCompletionRate: d.averageCompletionRate, atRiskStudentPercent: d.atRiskStudentPercent },
    }));

/** Declining-enrollment departments -> CURRICULUM_UPDATE. Real, from real Enrollment growth. */
const generateCurriculumRecommendations = (departmentAnalyticsList) =>
  departmentAnalyticsList
    .filter((d) => d.enrollmentTrendPercent < DEPARTMENT_DECLINE_TREND_PERCENT)
    .map((d) => ({
      type: RECOMMENDATION_TYPE.CURRICULUM_UPDATE,
      scopeType: SCOPE_TYPE.DEPARTMENT,
      scopeId: d.departmentKey,
      dedupeKey: buildDedupeKey("CURRICULUM_UPDATE", d.departmentKey),
      title: `${d.departmentKey} department enrollment is declining`,
      reason: `Enrollment trend is ${d.enrollmentTrendPercent}% — curriculum may need updating to stay relevant.`,
      urgency: Math.round(Math.min(100, Math.abs(d.enrollmentTrendPercent))),
      impact: 55,
      confidenceScore: 60,
      evidence: { enrollmentTrendPercent: d.enrollmentTrendPercent },
    }));

/** Institution-wide surge in HIGH-risk students -> RISK_INTERVENTION. Real, from Student State's own risk data — one platform-scoped strategic action, not a per-student duplicate of what Student State/Teacher Insight already surface individually. */
const generateRiskInterventionRecommendations = (highRiskStudents) => {
  if (highRiskStudents.length < RISK_SURGE_COUNT_THRESHOLD) return [];
  return [
    {
      type: RECOMMENDATION_TYPE.RISK_INTERVENTION,
      scopeType: SCOPE_TYPE.PLATFORM,
      scopeId: PLATFORM_SCOPE_ID,
      dedupeKey: buildDedupeKey("RISK_INTERVENTION", "PLATFORM"),
      title: "Institution-wide high-risk student count has surged",
      reason: `${highRiskStudents.length} student(s) are currently at HIGH dropout risk — consider a coordinated retention intervention.`,
      urgency: 85,
      impact: 80,
      confidenceScore: 75,
      evidence: { highRiskCount: highRiskStudents.length },
    },
  ];
};

/** Forecasted resource strain -> RESOURCE_ALLOCATION. Real, from capacityForecastEngine's own predictions. */
const generateResourceAllocationRecommendations = (capacityForecasts) =>
  capacityForecasts
    .filter(
      (f) => f.resourceType === CAPACITY_RESOURCE_TYPE.INSTRUCTOR_CAPACITY && f.predictedValue > CAPACITY_WARNING_ENROLLMENT_PER_INSTRUCTOR
    )
    .map((f) => ({
      type: RECOMMENDATION_TYPE.RESOURCE_ALLOCATION,
      scopeType: SCOPE_TYPE.PLATFORM,
      scopeId: PLATFORM_SCOPE_ID,
      dedupeKey: buildDedupeKey("RESOURCE_ALLOCATION", f.resourceType),
      title: "Projected student-to-instructor ratio is trending high",
      reason: `Forecasted ${f.predictedValue} students per instructor by ${new Date(f.forecastDate).toISOString().slice(0, 10)} — consider hiring ahead of next semester.`,
      urgency: 65,
      impact: 70,
      confidenceScore: f.confidenceScore,
      evidence: { predictedValue: f.predictedValue, forecastDate: f.forecastDate },
    }));

/**
 * Combines every generator, ranks by urgency*impact, caps the list — same
 * competing-candidates shape as Recommendation Agent's own pipeline.
 *
 * @param {import("../../types/adminIntelligence.types").InstitutionContext} context
 * @param {{facultyAnalyticsList: object[], departmentAnalyticsList: object[], capacityForecasts: object[]}} derived
 */
const buildStrategicRecommendations = (context, { facultyAnalyticsList, departmentAnalyticsList, capacityForecasts }) => {
  const candidates = [
    ...generateStaffingRecommendations(facultyAnalyticsList),
    ...generateCourseImprovementRecommendations(departmentAnalyticsList),
    ...generateCurriculumRecommendations(departmentAnalyticsList),
    ...generateRiskInterventionRecommendations(context.highRiskStudents),
    ...generateResourceAllocationRecommendations(capacityForecasts),
  ];

  return candidates.sort((a, b) => b.urgency * b.impact - a.urgency * a.impact).slice(0, STRATEGIC_RECOMMENDATION_CAP);
};

module.exports = { buildStrategicRecommendations };
