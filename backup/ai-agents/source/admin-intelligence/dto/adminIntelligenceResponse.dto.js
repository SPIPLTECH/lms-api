const toInstitutionHealthEntry = (health) =>
  health && {
    lmsHealthScore: health.lmsHealthScore,
    academicHealthScore: health.academicHealthScore,
    facultyPerformanceScore: health.facultyPerformanceScore,
    studentSuccessRate: health.studentSuccessRate,
    completionRate: health.completionRate,
    aiAdoptionScore: health.aiAdoptionScore,
    retentionRate: health.retentionRate,
    churnRate: health.churnRate,
    revenueEstimate: health.revenueEstimate,
    platformGrowthRate: health.platformGrowthRate,
    activeStudentCount: health.activeStudentCount,
    activeInstructorCount: health.activeInstructorCount,
    totalEnrollmentCount: health.totalEnrollmentCount,
    date: health.date,
    computedAt: health.computedAt,
  };

const toDepartmentEntry = (dept) => ({
  departmentKey: dept.departmentKey,
  courseCount: dept.courseCount,
  activeStudentCount: dept.activeStudentCount,
  averageCompletionRate: dept.averageCompletionRate,
  averageCourseHealthScore: dept.averageCourseHealthScore,
  atRiskStudentPercent: dept.atRiskStudentPercent,
  enrollmentTrendPercent: dept.enrollmentTrendPercent,
  healthScore: dept.healthScore,
  date: dept.date,
});

const toFacultyEntry = (faculty) => ({
  instructorId: faculty.instructorId,
  courseCount: faculty.courseCount,
  activeStudentCount: faculty.activeStudentCount,
  averageCourseHealthScore: faculty.averageCourseHealthScore,
  averageEngagementScore: faculty.averageEngagementScore,
  averageTeachingEffectiveness: faculty.averageTeachingEffectiveness,
  overloadFlag: faculty.overloadFlag,
  inactiveFlag: faculty.inactiveFlag,
  performanceScore: faculty.performanceScore,
  date: faculty.date,
});

const toInsightEntry = (insight) => ({
  id: insight.id,
  category: insight.category,
  scopeType: insight.scopeType,
  scopeId: insight.scopeId,
  title: insight.title,
  summary: insight.summary,
  priority: insight.priority,
  confidenceScore: insight.confidenceScore,
  evidence: insight.evidence,
  generatedAt: insight.generatedAt,
});

const toRecommendationEntry = (rec) => ({
  id: rec.id,
  type: rec.type,
  scopeType: rec.scopeType,
  scopeId: rec.scopeId,
  title: rec.title,
  reason: rec.reason,
  urgency: rec.urgency,
  impact: rec.impact,
  confidenceScore: rec.confidenceScore,
  evidence: rec.evidence,
  generatedAt: rec.generatedAt,
});

const toAlertEntry = (alert) => ({
  id: alert.id,
  scopeType: alert.scopeType,
  scopeId: alert.scopeId,
  alertType: alert.alertType,
  priority: alert.priority,
  status: alert.status,
  reason: alert.reason,
  evidence: alert.evidence,
  generatedAt: alert.generatedAt,
});

const toAuditEntry = (audit) => ({
  id: audit.id,
  checkType: audit.checkType,
  outcome: audit.outcome,
  severity: audit.severity,
  scopeType: audit.scopeType,
  scopeId: audit.scopeId,
  findings: audit.findings,
  evidence: audit.evidence,
  runAt: audit.runAt,
});

const toGovernanceMetricEntry = (metric) => ({
  metricKey: metric.metricKey,
  value: metric.value,
  unit: metric.unit,
  date: metric.date,
});

const toForecastEntry = (forecast) => ({
  resourceType: forecast.resourceType,
  forecastDate: forecast.forecastDate,
  predictedValue: forecast.predictedValue,
  confidenceScore: forecast.confidenceScore,
  method: forecast.method,
  basedOnDataPoints: forecast.basedOnDataPoints,
  computedAt: forecast.computedAt,
});

const toStudentRiskEntry = (student) => ({
  studentId: student.studentId,
  dropoutRiskScore: student.dropoutRiskScore,
  dropoutRiskLevel: student.dropoutRiskLevel,
  inactivityDays: student.inactivityDays,
});

const toReportEntry = (report) => ({
  id: report.id,
  reportType: report.reportType,
  periodStart: report.periodStart,
  periodEnd: report.periodEnd,
  summary: report.summary,
  healthSnapshot: report.healthSnapshot,
  departmentSummary: report.departmentSummary,
  facultySummary: report.facultySummary,
  insights: report.insights,
  recommendations: report.recommendations,
  alerts: report.alerts,
  forecasts: report.forecasts,
  version: report.version,
  generatedAt: report.generatedAt,
});

/** GET /admin-intelligence/dashboard — the full Executive Dashboard in one document. */
const toDashboardResponse = ({ institutionHealth, departments, faculty, insights, recommendations, alerts }) => ({
  institutionHealth: toInstitutionHealthEntry(institutionHealth),
  departments: departments.map(toDepartmentEntry),
  faculty: faculty.map(toFacultyEntry),
  insights: insights.map(toInsightEntry),
  recommendations: recommendations.map(toRecommendationEntry),
  alerts: alerts.map(toAlertEntry),
});

/** GET /admin-intelligence/institution-health */
const toInstitutionHealthResponse = (health) => toInstitutionHealthEntry(health);

/** GET /admin-intelligence/departments */
const toDepartmentListResponse = (departments) => ({ count: departments.length, departments: departments.map(toDepartmentEntry) });

/** GET /admin-intelligence/faculty */
const toFacultyListResponse = (faculty) => ({ count: faculty.length, faculty: faculty.map(toFacultyEntry) });

/** GET /admin-intelligence/student-risk */
const toStudentRiskResponse = (highRiskStudents) => ({ count: highRiskStudents.length, students: highRiskStudents.map(toStudentRiskEntry) });

/** GET /admin-intelligence/compliance */
const toComplianceResponse = ({ recentAudits, governanceMetrics }) => ({
  recentAudits: recentAudits.map(toAuditEntry),
  governanceMetrics: governanceMetrics.map(toGovernanceMetricEntry),
});

/** GET /admin-intelligence/forecasts */
const toForecastListResponse = (forecasts) => ({ count: forecasts.length, forecasts: forecasts.map(toForecastEntry) });

/** GET /admin-intelligence/alerts */
const toAlertListResponse = (alerts) => ({ count: alerts.length, alerts: alerts.map(toAlertEntry) });

/** GET /admin-intelligence/reports */
const toReportListResponse = (reports) => ({ count: reports.length, reports: reports.map(toReportEntry) });

/** POST /admin-intelligence/recalculate */
const toRecalculateResponse = (result) => ({
  trigger: result.trigger,
  institutionHealth: toInstitutionHealthEntry(result.institutionHealth),
  departmentsUpdated: result.departmentsUpdated,
  facultyUpdated: result.facultyUpdated,
  complianceChecksRun: result.complianceChecksRun,
  forecastsGenerated: result.forecastsGenerated,
  insightsGenerated: result.insightsGenerated,
  recommendationsGenerated: result.recommendationsGenerated,
  alertsGenerated: result.alertsGenerated,
  retired: result.retired,
});

module.exports = {
  toInstitutionHealthEntry,
  toDepartmentEntry,
  toFacultyEntry,
  toInsightEntry,
  toRecommendationEntry,
  toAlertEntry,
  toAuditEntry,
  toGovernanceMetricEntry,
  toForecastEntry,
  toStudentRiskEntry,
  toReportEntry,
  toDashboardResponse,
  toInstitutionHealthResponse,
  toDepartmentListResponse,
  toFacultyListResponse,
  toStudentRiskResponse,
  toComplianceResponse,
  toForecastListResponse,
  toAlertListResponse,
  toReportListResponse,
  toRecalculateResponse,
};
