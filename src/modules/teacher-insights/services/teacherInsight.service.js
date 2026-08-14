const prisma = require("../../../config/database");
const ApiError = require("../../../utils/ApiError");

const studentAlertRepository = require("../repositories/studentAlert.repository");
const courseInsightRepository = require("../repositories/courseInsight.repository");
const courseHealthRepository = require("../repositories/courseHealth.repository");
const teachingRecommendationRepository = require("../repositories/teachingRecommendation.repository");
const teacherInsightRepository = require("../repositories/teacherInsight.repository");
const historyRepository = require("../repositories/insightHistory.repository");
const analyticsRepository = require("../repositories/insightAnalytics.repository");

const { buildContext } = require("./context/courseContextBuilder");
const { generateAllInsights } = require("./domain/detectors");
const { rankInsights } = require("./domain/rankingEngine");

const { teacherInsightBus } = require("../events/eventBus");
const { TEACHER_INSIGHT_EVENT_NAMES } = require("../events/eventNames");

const {
  toCourseDashboardResponse,
  toTeacherDashboardResponse,
  toStudentAlertListResponse,
  toClassPerformanceResponse,
  toRecommendationListResponse,
  toReportResponse,
  toCourseHealthEntry,
} = require("../dto/teacherInsightResponse.dto");

const { INSIGHT_SOURCE_MODEL, RETIRED_REASON, TEACHER_REPORT_TYPE, WEEKLY_SUMMARY_DAYS, MONTHLY_SUMMARY_DAYS } = require("../constants");

/**
 * Retires a set of no-longer-generated rows for one source model: snapshots
 * each to InsightHistory, then flips its live status to RESOLVED. Shared
 * across all three "live, upserted" model types via this small dispatch
 * table rather than three near-identical copies of the same loop.
 */
const REPOSITORY_BY_SOURCE = {
  [INSIGHT_SOURCE_MODEL.STUDENT_ALERT]: studentAlertRepository,
  [INSIGHT_SOURCE_MODEL.COURSE_INSIGHT]: courseInsightRepository,
  [INSIGHT_SOURCE_MODEL.TEACHING_RECOMMENDATION]: teachingRecommendationRepository,
};

const retireStale = async (sourceModel, courseId, existingActiveKeys, stillGeneratedIds) => {
  const repository = REPOSITORY_BY_SOURCE[sourceModel];
  const toRetire = existingActiveKeys.filter((row) => !stillGeneratedIds.has(row.id));

  for (const row of toRetire) {
    const full = await repository.findById(row.id);
    if (!full) continue;
    await historyRepository.createSnapshot(sourceModel, full, full.alertType || full.insightType || full.recommendationType, RETIRED_REASON.SUPERSEDED);
    await repository.updateStatus(row.id, "RESOLVED");
    await analyticsRepository.increment(courseId, full.alertType || full.insightType || full.recommendationType, "resolvedCount");
  }

  return toRetire.length;
};

/**
 * The core pipeline: Aggregate Class Data -> Analyze Student Trends ->
 * Analyze Course Performance -> Generate Instructor Insights -> Rank
 * Priority Issues -> Persist -> Publish. Called on every trigger (debounced
 * event, scheduler, or explicit POST /teacher-insights/recalculate).
 *
 * @param {string} courseId
 * @param {string} [trigger] - for logging only.
 */
const generateForCourse = async (courseId, trigger = "manual") => {
  const context = await buildContext(courseId);
  const { studentAlerts, courseInsights, courseHealth, teachingRecommendations } = generateAllInsights(context);

  const rankedAlerts = rankInsights(studentAlerts);
  const rankedInsights = rankInsights(courseInsights);
  const rankedRecommendations = rankInsights(teachingRecommendations);

  const [existingAlertKeys, existingInsightKeys, existingRecommendationKeys] = await Promise.all([
    studentAlertRepository.findAllActiveKeys(courseId),
    courseInsightRepository.findAllActiveKeys(courseId),
    teachingRecommendationRepository.findAllActiveKeys(courseId),
  ]);

  const persistedAlertIds = new Set();
  for (const candidate of rankedAlerts) {
    const row = await studentAlertRepository.upsertCandidate(courseId, candidate);
    persistedAlertIds.add(row.id);
    await analyticsRepository.increment(courseId, candidate.alertType, "generatedCount", context.now);
  }

  const persistedInsightIds = new Set();
  for (const candidate of rankedInsights) {
    const row = await courseInsightRepository.upsertCandidate(courseId, candidate);
    persistedInsightIds.add(row.id);
    await analyticsRepository.increment(courseId, candidate.insightType, "generatedCount", context.now);
  }

  const persistedRecommendationIds = new Set();
  for (const candidate of rankedRecommendations) {
    const row = await teachingRecommendationRepository.upsertCandidate(courseId, candidate);
    persistedRecommendationIds.add(row.id);
    await analyticsRepository.increment(courseId, candidate.recommendationType, "generatedCount", context.now);
  }

  await courseHealthRepository.upsert(courseId, courseHealth, context.now);

  const [retiredAlerts, retiredInsights, retiredRecommendations] = await Promise.all([
    retireStale(INSIGHT_SOURCE_MODEL.STUDENT_ALERT, courseId, existingAlertKeys, persistedAlertIds),
    retireStale(INSIGHT_SOURCE_MODEL.COURSE_INSIGHT, courseId, existingInsightKeys, persistedInsightIds),
    retireStale(INSIGHT_SOURCE_MODEL.TEACHING_RECOMMENDATION, courseId, existingRecommendationKeys, persistedRecommendationIds),
  ]);

  teacherInsightBus.publish(TEACHER_INSIGHT_EVENT_NAMES.TEACHER_INSIGHT_UPDATED, {
    courseId,
    teacherId: context.course?.creatorId,
    trigger,
    timestamp: context.now,
  });

  return {
    courseId,
    studentAlertsGenerated: rankedAlerts.length,
    courseInsightsGenerated: rankedInsights.length,
    teachingRecommendationsGenerated: rankedRecommendations.length,
    retired: retiredAlerts + retiredInsights + retiredRecommendations,
  };
};

const recalculate = (courseId) => generateForCourse(courseId, "manual-recalculate");

const getCourseDashboard = async (courseId) => {
  const [studentAlerts, courseInsights, courseHealth, teachingRecommendations] = await Promise.all([
    studentAlertRepository.findActiveByCourse(courseId),
    courseInsightRepository.findActiveByCourse(courseId),
    courseHealthRepository.findByCourse(courseId),
    teachingRecommendationRepository.findActiveByCourse(courseId),
  ]);

  return toCourseDashboardResponse(courseId, { studentAlerts, courseInsights, courseHealth, teachingRecommendations });
};

const getTeacherDashboard = async (teacherId) => {
  const courses = await prisma.course.findMany({ where: { creatorId: teacherId }, select: { id: true, title: true } });

  const courseDashboards = await Promise.all(
    courses.map(async (course) => ({ courseId: course.id, courseTitle: course.title, ...(await getCourseDashboard(course.id)) }))
  );

  return toTeacherDashboardResponse(teacherId, courseDashboards);
};

const getStudentsAtRisk = async (courseId) => {
  const alerts = await studentAlertRepository.findActiveByCourse(courseId, { alertType: "AT_RISK" });
  return toStudentAlertListResponse(courseId, alerts);
};

const getCourseHealth = async (courseId) => {
  const health = await courseHealthRepository.findByCourse(courseId);
  if (!health) throw new ApiError(404, "No course health calculated yet for this course");
  return { courseId, ...toCourseHealthEntry(health) };
};

const getClassPerformance = async (courseId) => {
  const [courseInsights, courseHealth] = await Promise.all([
    courseInsightRepository.findActiveByCourse(courseId),
    courseHealthRepository.findByCourse(courseId),
  ]);
  return toClassPerformanceResponse(courseId, { courseInsights, courseHealth });
};

const getRecommendations = async (courseId) => {
  const recommendations = await teachingRecommendationRepository.findActiveByCourse(courseId);
  return toRecommendationListResponse(courseId, recommendations);
};

/**
 * Builds and persists a periodic report: bundles counts/highlights from the
 * currently-active StudentAlert/CourseInsight/CourseHealth/
 * TeachingRecommendation rows for the course. Get-or-generate semantics —
 * callable both by the weekly/monthly schedulers and on-demand from the API.
 */
const buildAndPersistReport = async (courseId, reportType) => {
  const course = await prisma.course.findUnique({ where: { id: courseId }, select: { creatorId: true } });
  if (!course) throw new ApiError(404, "Course not found");

  const now = new Date();
  const periodDays = reportType === TEACHER_REPORT_TYPE.MONTHLY_SUMMARY ? MONTHLY_SUMMARY_DAYS : WEEKLY_SUMMARY_DAYS;
  const periodStart = new Date(now.getTime() - periodDays * 24 * 3600 * 1000);

  const [studentAlerts, courseInsights, courseHealth, teachingRecommendations] = await Promise.all([
    studentAlertRepository.findActiveByCourse(courseId),
    courseInsightRepository.findActiveByCourse(courseId),
    courseHealthRepository.findByCourse(courseId),
    teachingRecommendationRepository.findActiveByCourse(courseId),
  ]);

  const atRiskCount = studentAlerts.filter((a) => a.alertType === "AT_RISK").length;
  const topPerformerCount = studentAlerts.filter((a) => a.alertType === "TOP_PERFORMER").length;

  const highlights = {
    courseHealthScore: courseHealth?.courseHealthScore ?? null,
    classEngagementScore: courseHealth?.classEngagementScore ?? null,
    atRiskCount,
    topPerformerCount,
    weakConceptCount: courseInsights.filter((i) => i.insightType === "WEAK_CONCEPT").length,
    difficultLessonCount: courseInsights.filter((i) => i.insightType === "LESSON_COMPLETION_TREND").length,
    difficultQuizCount: courseInsights.filter((i) => i.insightType === "QUIZ_PERFORMANCE_TREND").length,
    topInstructorActions: teachingRecommendations.slice(0, 5).map((r) => r.suggestedAction),
  };

  const summary =
    `Course health is ${highlights.courseHealthScore ?? "not yet calculated"}. ` +
    `${atRiskCount} student(s) at risk, ${topPerformerCount} excelling. ` +
    `${highlights.weakConceptCount} weak concept(s) and ${highlights.difficultLessonCount} low-completion lesson(s) detected.`;

  const report = await teacherInsightRepository.upsertReport(courseId, course.creatorId, {
    reportType,
    periodStart,
    periodEnd: now,
    summary,
    highlights,
    confidenceScore: 70,
  });

  return report;
};

const getWeeklySummary = (courseId) => buildAndPersistReport(courseId, TEACHER_REPORT_TYPE.WEEKLY_SUMMARY).then(toReportResponse);
const getMonthlySummary = (courseId) => buildAndPersistReport(courseId, TEACHER_REPORT_TYPE.MONTHLY_SUMMARY).then(toReportResponse);

module.exports = {
  generateForCourse,
  recalculate,
  getCourseDashboard,
  getTeacherDashboard,
  getStudentsAtRisk,
  getCourseHealth,
  getClassPerformance,
  getRecommendations,
  getWeeklySummary,
  getMonthlySummary,
  buildAndPersistReport,
};
