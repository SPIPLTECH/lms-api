const ApiError = require("../../../utils/ApiError");

const institutionHealthRepository = require("../repositories/institutionHealth.repository");
const departmentAnalyticsRepository = require("../repositories/departmentAnalytics.repository");
const facultyAnalyticsRepository = require("../repositories/facultyAnalytics.repository");
const adminInsightRepository = require("../repositories/adminInsight.repository");
const strategicRecommendationRepository = require("../repositories/strategicRecommendation.repository");
const complianceAuditRepository = require("../repositories/complianceAudit.repository");
const capacityForecastRepository = require("../repositories/capacityForecast.repository");
const adminAlertRepository = require("../repositories/adminAlert.repository");
const executiveReportRepository = require("../repositories/executiveReport.repository");
const governanceMetricRepository = require("../repositories/governanceMetric.repository");
const studentStateModule = require("../../student-state");

const { buildInstitutionContext } = require("./context/institutionContextBuilder");
const { calculateInstitutionHealth } = require("./domain/healthScoreEngine");
const { calculateFacultyAnalytics } = require("./domain/facultyAggregator");
const { calculateDepartmentAnalytics } = require("./domain/departmentAggregator");
const { runComplianceChecks, deriveGovernanceMetrics } = require("./domain/complianceAuditEngine");
const { calculateCapacityForecasts } = require("./domain/capacityForecastEngine");
const { buildStrategicRecommendations } = require("./domain/strategicRecommendationEngine");
const { buildAdminInsights } = require("./domain/insightEngine");
const { buildAdminAlerts } = require("./domain/alertEngine");

const { exportReport: writeReportExport } = require("../exporters");

const { adminIntelligenceBus } = require("../events/eventBus");
const { ADMIN_INTELLIGENCE_EVENT_NAMES } = require("../events/eventNames");

const { INSIGHT_STATUS, RECOMMENDATION_STATUS, ALERT_STATUS, REPORT_TYPE, PERIOD_DAYS_BY_REPORT_TYPE } = require("../constants");
const {
  toDashboardResponse,
  toInstitutionHealthResponse,
  toDepartmentListResponse,
  toFacultyListResponse,
  toStudentRiskResponse,
  toComplianceResponse,
  toReportListResponse,
  toReportEntry,
  toForecastListResponse,
  toAlertListResponse,
  toRecalculateResponse,
} = require("../dto/adminIntelligenceResponse.dto");

/**
 * Retires rows that were active before this run but weren't regenerated —
 * same "retire what's no longer generated" idea as Recommendation/Teacher
 * Insight, applied generically across AdminInsight/StrategicRecommendation/
 * AdminAlert via one shared helper instead of three near-identical copies.
 */
const retireStale = async (repository, previousActiveKeys, stillGeneratedDedupeKeys, resolvedStatus) => {
  const toRetire = previousActiveKeys.filter((row) => !stillGeneratedDedupeKeys.has(row.dedupeKey));
  for (const row of toRetire) {
    await repository.updateStatus(row.id, resolvedStatus);
  }
  return toRetire.length;
};

/**
 * The core pipeline: Aggregate Institutional Data -> Run Predictive Models
 * -> Calculate Institutional KPIs -> Generate Executive Insights -> Generate
 * Strategic Recommendations -> Persist Reports -> Publish
 * AdminInsightUpdated. Called on every trigger (debounced peer-agent event,
 * daily sweep, or an explicit POST /admin-intelligence/recalculate).
 *
 * @param {string} [trigger] - for logging only.
 */
const generateInsights = async (trigger = "manual") => {
  const context = await buildInstitutionContext();

  const facultyAnalyticsList = calculateFacultyAnalytics(context);
  const departmentAnalyticsList = calculateDepartmentAnalytics(context);
  const institutionHealth = calculateInstitutionHealth(context, { facultyAnalyticsList, departmentAnalyticsList });

  await institutionHealthRepository.upsertDaily(institutionHealth, context.now);
  await Promise.all(departmentAnalyticsList.map((d) => departmentAnalyticsRepository.upsertDaily(d.departmentKey, d, context.now)));
  await Promise.all(facultyAnalyticsList.map((f) => facultyAnalyticsRepository.upsertDaily(f.instructorId, f, context.now)));

  const complianceAuditResults = runComplianceChecks(context);
  await complianceAuditRepository.createMany(complianceAuditResults.map((a) => ({ ...a, runAt: context.now })));

  const governanceMetrics = deriveGovernanceMetrics(complianceAuditResults);
  await Promise.all(governanceMetrics.map((m) => governanceMetricRepository.recordDaily(m.metricKey, m.value, m.unit, context.now)));

  const capacityForecasts = calculateCapacityForecasts(context);
  await Promise.all(capacityForecasts.map((f) => capacityForecastRepository.upsert(f)));

  const strategicCandidates = buildStrategicRecommendations(context, { facultyAnalyticsList, departmentAnalyticsList, capacityForecasts });
  const previousRecommendationKeys = await strategicRecommendationRepository.findAllActiveKeys();
  for (const candidate of strategicCandidates) await strategicRecommendationRepository.upsertCandidate(candidate);
  const retiredRecommendations = await retireStale(
    strategicRecommendationRepository,
    previousRecommendationKeys,
    new Set(strategicCandidates.map((c) => c.dedupeKey)),
    RECOMMENDATION_STATUS.EXPIRED
  );

  const insightCandidates = buildAdminInsights(context, { institutionHealth, departmentAnalyticsList, governanceMetrics });
  const previousInsightKeys = await adminInsightRepository.findAllActiveKeys();
  for (const candidate of insightCandidates) await adminInsightRepository.upsertCandidate(candidate);
  const retiredInsights = await retireStale(
    adminInsightRepository,
    previousInsightKeys,
    new Set(insightCandidates.map((c) => c.dedupeKey)),
    INSIGHT_STATUS.EXPIRED
  );

  const alertCandidates = buildAdminAlerts(context, { facultyAnalyticsList, departmentAnalyticsList, complianceAuditResults, capacityForecasts });
  const previousAlertKeys = await adminAlertRepository.findAllActiveKeys();
  for (const candidate of alertCandidates) await adminAlertRepository.upsertCandidate(candidate);
  const retiredAlerts = await retireStale(
    adminAlertRepository,
    previousAlertKeys,
    new Set(alertCandidates.map((c) => c.dedupeKey)),
    ALERT_STATUS.RESOLVED
  );

  adminIntelligenceBus.publish(ADMIN_INTELLIGENCE_EVENT_NAMES.ADMIN_INSIGHT_UPDATED, { trigger, timestamp: context.now });

  return {
    trigger,
    institutionHealth,
    departmentsUpdated: departmentAnalyticsList.length,
    facultyUpdated: facultyAnalyticsList.length,
    complianceChecksRun: complianceAuditResults.length,
    forecastsGenerated: capacityForecasts.length,
    insightsGenerated: insightCandidates.length,
    recommendationsGenerated: strategicCandidates.length,
    alertsGenerated: alertCandidates.length,
    retired: retiredInsights + retiredRecommendations + retiredAlerts,
  };
};

const recalculate = (trigger = "manual-recalculate") => generateInsights(trigger).then(toRecalculateResponse);

const getDashboard = async () => {
  const [institutionHealth, departments, faculty, insights, recommendations, alerts] = await Promise.all([
    institutionHealthRepository.findLatest(),
    departmentAnalyticsRepository.findLatestAll(),
    facultyAnalyticsRepository.findLatestAll(),
    adminInsightRepository.findActive(),
    strategicRecommendationRepository.findActive(),
    adminAlertRepository.findActive(),
  ]);

  return toDashboardResponse({ institutionHealth, departments, faculty, insights, recommendations, alerts });
};

const getInstitutionHealth = async () => {
  const health = await institutionHealthRepository.findLatest();
  if (!health) throw new ApiError(404, "Institution health has not been calculated yet");
  return toInstitutionHealthResponse(health);
};

const getDepartments = async () => {
  const departments = await departmentAnalyticsRepository.findLatestAll();
  return toDepartmentListResponse(departments);
};

const getFaculty = async () => {
  const faculty = await facultyAnalyticsRepository.findLatestAll();
  return toFacultyListResponse(faculty);
};

/**
 * Live read, not a persisted table — Student State already owns the real
 * risk data (see events/eventConsumer.js doc), this just exposes its own
 * getHighRiskStudents() getter through this agent's own route, same
 * "aggregates the aggregators" boundary as everywhere else in this module.
 */
const getStudentRisk = async () => {
  const highRiskStudents = await studentStateModule.getHighRiskStudents(["HIGH", "MEDIUM"]);
  return toStudentRiskResponse(highRiskStudents);
};

const getCompliance = async () => {
  const [recentAudits, governanceMetrics] = await Promise.all([
    complianceAuditRepository.findRecent({ limit: 50 }),
    governanceMetricRepository.findLatestAll(),
  ]);
  return toComplianceResponse({ recentAudits, governanceMetrics });
};

const getForecasts = async (resourceType) => {
  const forecasts = resourceType ? await capacityForecastRepository.findByResourceType(resourceType) : await capacityForecastRepository.findAll();
  return toForecastListResponse(forecasts);
};

const getAlerts = async (priority) => {
  const alerts = await adminAlertRepository.findActive({ priority });
  return toAlertListResponse(alerts);
};

const getReports = async (reportType) => {
  const reports = await executiveReportRepository.findByType(reportType);
  return toReportListResponse(reports);
};

/**
 * Builds and persists one periodic executive report — bundles whatever's
 * already been computed/persisted by generateInsights, doesn't recompute
 * (same pattern as Analytics' own buildAndPersistReport).
 *
 * @param {"WEEKLY"|"MONTHLY"|"QUARTERLY"|"ANNUAL"|"SEMESTER"} reportType
 */
const buildAndPersistReport = async (reportType) => {
  const now = new Date();
  const periodDays = PERIOD_DAYS_BY_REPORT_TYPE[reportType];
  const periodStart = new Date(now.getTime() - periodDays * 24 * 3600 * 1000);

  const [institutionHealth, departments, faculty, insights, recommendations, alerts, forecasts] = await Promise.all([
    institutionHealthRepository.findLatest(),
    departmentAnalyticsRepository.findLatestAll(),
    facultyAnalyticsRepository.findLatestAll(),
    adminInsightRepository.findActive(),
    strategicRecommendationRepository.findActive(),
    adminAlertRepository.findActive(),
    capacityForecastRepository.findAll(),
  ]);

  const summary =
    `Institution ${reportType.toLowerCase()} report, period starting ${periodStart.toISOString().slice(0, 10)}: ` +
    `LMS health score ${institutionHealth?.lmsHealthScore ?? "not yet calculated"}, ${departments.length} department(s), ` +
    `${faculty.length} faculty member(s) tracked, ${alerts.length} active alert(s), ${recommendations.length} strategic recommendation(s).`;

  const report = await executiveReportRepository.upsertReport({
    reportType,
    periodStart,
    periodEnd: now,
    summary,
    healthSnapshot: institutionHealth || {},
    departmentSummary: departments,
    facultySummary: faculty,
    insights,
    recommendations,
    alerts,
    forecasts,
  });

  return report;
};

const getReportForExport = async ({ reportId, reportType }) => {
  if (reportId) {
    const report = await executiveReportRepository.findById(reportId);
    if (!report) throw new ApiError(404, "Report not found");
    return report;
  }
  if (reportType) {
    const rows = await executiveReportRepository.findByType(reportType);
    if (rows.length === 0) throw new ApiError(404, `No ${reportType} report has been generated yet`);
    return rows[0];
  }
  throw new ApiError(400, "reportId or reportType is required");
};

/** POST /admin-intelligence/report/export */
const exportReport = async ({ reportId, reportType, format }) => {
  const report = await getReportForExport({ reportId, reportType });
  return writeReportExport(toReportEntry(report), format);
};

module.exports = {
  generateInsights,
  recalculate,
  getDashboard,
  getInstitutionHealth,
  getDepartments,
  getFaculty,
  getStudentRisk,
  getCompliance,
  getForecasts,
  getAlerts,
  getReports,
  buildAndPersistReport,
  exportReport,
};
