const toStudentAlertEntry = (alert) => ({
  id: alert.id,
  studentId: alert.studentId,
  alertType: alert.alertType,
  priority: alert.priority,
  status: alert.status,
  confidenceScore: alert.confidenceScore,
  reason: alert.reason,
  evidence: alert.evidence,
  version: alert.version,
  generatedAt: alert.generatedAt,
});

const toCourseInsightEntry = (insight) => ({
  id: insight.id,
  insightType: insight.insightType,
  priority: insight.priority,
  status: insight.status,
  confidenceScore: insight.confidenceScore,
  title: insight.title,
  reason: insight.reason,
  affectedStudentCount: insight.affectedStudentCount,
  evidence: insight.evidence,
  moduleId: insight.moduleId,
  lessonId: insight.lessonId,
  quizId: insight.quizId,
  assignmentId: insight.assignmentId,
  generatedAt: insight.generatedAt,
});

const toTeachingRecommendationEntry = (rec) => ({
  id: rec.id,
  recommendationType: rec.recommendationType,
  priority: rec.priority,
  status: rec.status,
  confidenceScore: rec.confidenceScore,
  suggestedAction: rec.suggestedAction,
  reason: rec.reason,
  affectedStudentCount: rec.affectedStudentCount,
  evidence: rec.evidence,
  generatedAt: rec.generatedAt,
});

const toCourseHealthEntry = (health) =>
  health && {
    courseHealthScore: health.courseHealthScore,
    classEngagementScore: health.classEngagementScore,
    classPerformanceScore: health.classPerformanceScore,
    completionRate: health.completionRate,
    atRiskStudentPercent: health.atRiskStudentPercent,
    enrolledCount: health.enrolledCount,
    activeStudentCount: health.activeStudentCount,
    lastCalculatedAt: health.lastCalculatedAt,
  };

/** GET /teacher-insights/course/:courseId — everything for one course. */
const toCourseDashboardResponse = (courseId, { studentAlerts, courseInsights, courseHealth, teachingRecommendations }) => ({
  courseId,
  studentAlerts: studentAlerts.map(toStudentAlertEntry),
  courseInsights: courseInsights.map(toCourseInsightEntry),
  courseHealth: toCourseHealthEntry(courseHealth),
  teachingRecommendations: teachingRecommendations.map(toTeachingRecommendationEntry),
});

/** GET /teacher-insights/:teacherId — every owned course's dashboard, keyed by courseId. */
const toTeacherDashboardResponse = (teacherId, courseDashboards) => ({
  teacherId,
  courses: courseDashboards,
});

/** GET /teacher-insights/students-at-risk */
const toStudentAlertListResponse = (courseId, alerts) => ({
  courseId,
  count: alerts.length,
  alerts: alerts.map(toStudentAlertEntry),
});

/** GET /teacher-insights/class-performance */
const toClassPerformanceResponse = (courseId, { courseInsights, courseHealth }) => ({
  courseId,
  courseHealth: toCourseHealthEntry(courseHealth),
  insights: courseInsights.map(toCourseInsightEntry),
});

/** GET /teacher-insights/recommendations */
const toRecommendationListResponse = (courseId, recommendations) => ({
  courseId,
  count: recommendations.length,
  recommendations: recommendations.map(toTeachingRecommendationEntry),
});

/** GET /teacher-insights/weekly-summary, /monthly-summary */
const toReportResponse = (report) =>
  report && {
    id: report.id,
    courseId: report.courseId,
    teacherId: report.teacherId,
    reportType: report.reportType,
    periodStart: report.periodStart,
    periodEnd: report.periodEnd,
    summary: report.summary,
    highlights: report.highlights,
    confidenceScore: report.confidenceScore,
    generatedAt: report.generatedAt,
  };

/** POST /teacher-insights/recalculate */
const toRecalculateResponse = (result) => ({
  courseId: result.courseId,
  studentAlertsGenerated: result.studentAlertsGenerated,
  courseInsightsGenerated: result.courseInsightsGenerated,
  teachingRecommendationsGenerated: result.teachingRecommendationsGenerated,
  retired: result.retired,
});

module.exports = {
  toStudentAlertEntry,
  toCourseInsightEntry,
  toTeachingRecommendationEntry,
  toCourseHealthEntry,
  toCourseDashboardResponse,
  toTeacherDashboardResponse,
  toStudentAlertListResponse,
  toClassPerformanceResponse,
  toRecommendationListResponse,
  toReportResponse,
  toRecalculateResponse,
};
