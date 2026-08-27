const ApiError = require("../../../utils/ApiError");

const kpiRepository = require("../repositories/kpi.repository");
const historyRepository = require("../repositories/analyticsHistory.repository");
const dashboardMetricRepository = require("../repositories/dashboardMetric.repository");
const trendRepository = require("../repositories/trendAnalysis.repository");
const forecastRepository = require("../repositories/forecast.repository");
const reportRepository = require("../repositories/report.repository");

const { calculateMetricsForScope } = require("./domain/calculators");
const { detectTrend } = require("./domain/trendDetector");
const { forecastLinear } = require("./domain/forecastEngine");
const { resolvePeriodStart } = require("./domain/reportPeriod");

const { exportReport: writeReportExport } = require("../exporters");

const { analyticsBus } = require("../events/eventBus");
const { ANALYTICS_EVENT_NAMES } = require("../events/eventNames");

const { resolveScopeId } = require("../utils/scopeKey.util");
const { resolveDefaultScope } = require("../utils/accessControl.util");

const { SCOPE_TYPE, PLATFORM_SCOPE_ID, TREND_WINDOW_DAYS, FORECAST_HISTORY_LOOKBACK_DAYS } = require("../constants");

const {
  toScopeSnapshotResponse,
  toKpiListResponse,
  toTrendListResponse,
  toForecastListResponse,
  toReportEntry,
  toReportListResponse,
  toRecalculateResponse,
  toKpiEntry,
} = require("../dto/analyticsResponse.dto");

/**
 * The core pipeline: Aggregate Data -> Calculate KPIs -> Generate Trends ->
 * Generate Forecasts -> Generate Dashboard Metrics -> Persist -> Publish.
 * Called on every trigger (debounced event, scheduler sweep, or an explicit
 * POST /analytics/recalculate).
 *
 * @param {import("../types/analytics.types").ScopeType} scopeType
 * @param {string} rawScopeId - ignored for PLATFORM (collapses to the sentinel).
 * @param {string} [trigger] - for logging only.
 */
const generateForScope = async (scopeType, rawScopeId, trigger = "manual") => {
  const scopeId = resolveScopeId(scopeType, rawScopeId);
  if (!scopeId) throw new Error(`scopeId is required for scope type ${scopeType}`);

  const now = new Date();
  const lookbackStart = new Date(now.getTime() - FORECAST_HISTORY_LOOKBACK_DAYS * 24 * 3600 * 1000);

  const metrics = await calculateMetricsForScope(scopeType, scopeId);

  const historyByMetric = {};
  let trendsGenerated = 0;
  let forecastsGenerated = 0;

  for (const metric of metrics) {
    await historyRepository.recordDaily(scopeType, scopeId, metric.metricKey, metric.value, now);

    const historyRows = await historyRepository.findSince(scopeType, scopeId, metric.metricKey, lookbackStart);
    historyByMetric[metric.metricKey] = historyRows.map((row) => ({ date: row.date, value: row.value }));

    const trend = detectTrend(historyByMetric[metric.metricKey], metric.value, TREND_WINDOW_DAYS);
    await trendRepository.upsert(scopeType, scopeId, metric.metricKey, trend);
    trendsGenerated += 1;

    await kpiRepository.upsert(scopeType, scopeId, { ...metric, trend: trend.direction, changePercent: trend.changePercent }, now);

    const forecast = forecastLinear(historyByMetric[metric.metricKey]);
    if (forecast) {
      await forecastRepository.upsert(scopeType, scopeId, metric.metricKey, forecast);
      forecastsGenerated += 1;
    }
  }

  // Dashboard-ready cache: GET /analytics/dashboard reads these two keys
  // directly rather than recomputing joins per request. "history" reuses
  // the AnalyticsHistory rows already fetched above for trend detection —
  // no extra query.
  const kpiSummary = metrics.map((metric) => ({
    metricKey: metric.metricKey,
    value: metric.value,
    unit: metric.unit || null,
  }));
  await dashboardMetricRepository.upsert(scopeType, scopeId, "kpiSummary", kpiSummary);
  await dashboardMetricRepository.upsert(scopeType, scopeId, "history", historyByMetric);

  analyticsBus.publish(ANALYTICS_EVENT_NAMES.ANALYTICS_UPDATED, { scopeType, scopeId, trigger, timestamp: now });

  return { scopeType, scopeId, metricsGenerated: metrics.length, trendsGenerated, forecastsGenerated };
};

const recalculate = (scopeType, scopeId) => generateForScope(scopeType, scopeId, "manual-recalculate").then(toRecalculateResponse);

const getScopeSnapshot = async (scopeType, rawScopeId) => {
  const scopeId = resolveScopeId(scopeType, rawScopeId);
  const [kpis, trends, dashboardMetrics] = await Promise.all([
    kpiRepository.findByScope(scopeType, scopeId),
    trendRepository.findByScope(scopeType, scopeId),
    dashboardMetricRepository.findByScope(scopeType, scopeId),
  ]);
  return toScopeSnapshotResponse(scopeType, scopeId, { kpis, trends, dashboardMetrics });
};

/** GET /analytics/dashboard — role-aware default: STUDENT->own student scope, INSTRUCTOR->own instructor scope, ADMIN->platform scope. */
const getDashboard = (actor) => {
  const { scopeType, scopeId } = resolveDefaultScope(actor);
  return getScopeSnapshot(scopeType, scopeId);
};

const getByStudent = (studentId) => getScopeSnapshot(SCOPE_TYPE.STUDENT, studentId);
const getByInstructor = (instructorId) => getScopeSnapshot(SCOPE_TYPE.INSTRUCTOR, instructorId);
const getByCourse = (courseId) => getScopeSnapshot(SCOPE_TYPE.COURSE, courseId);
const getPlatform = () => getScopeSnapshot(SCOPE_TYPE.PLATFORM, PLATFORM_SCOPE_ID);

/**
 * Trusted, cross-agent read (the Admin Intelligence Agent uses this to
 * compose the institution health score without recomputing what this agent
 * already owns). Same shape `getPlatform()` already returns to its own
 * routes — no separate response shape needed for a second consumer.
 */
const getPlatformKPIs = () => getPlatform();

/**
 * Batched course KPI read for institution-wide rollups (e.g. Admin
 * Intelligence grouping course KPIs by Course.category as its department
 * proxy) — one IN-query via kpiRepository.findByScopesBatch, not a
 * per-course loop.
 *
 * @param {string[]} courseIds
 * @returns {Promise<Record<string, object[]>>} courseId -> KPI entries
 */
const getCourseKPIsBatch = async (courseIds) => {
  if (!courseIds || courseIds.length === 0) return {};
  const rows = await kpiRepository.findByScopesBatch(SCOPE_TYPE.COURSE, courseIds);
  const byCourse = {};
  for (const id of courseIds) byCourse[id] = [];
  for (const row of rows) byCourse[row.scopeId].push(toKpiEntry(row));
  return byCourse;
};

/**
 * Batched instructor KPI read (e.g. Admin Intelligence's faculty-performance
 * rollup needs the real TEACHING_EFFECTIVENESS/COURSE_PERFORMANCE numbers
 * this agent already computes, not a re-derived proxy) — one IN-query, not
 * a per-instructor loop.
 *
 * @param {string[]} instructorIds
 * @returns {Promise<Record<string, object[]>>} instructorId -> KPI entries
 */
const getInstructorKPIsBatch = async (instructorIds) => {
  if (!instructorIds || instructorIds.length === 0) return {};
  const rows = await kpiRepository.findByScopesBatch(SCOPE_TYPE.INSTRUCTOR, instructorIds);
  const byInstructor = {};
  for (const id of instructorIds) byInstructor[id] = [];
  for (const row of rows) byInstructor[row.scopeId].push(toKpiEntry(row));
  return byInstructor;
};

const getKPIs = async (scopeType, rawScopeId, metricKey) => {
  const scopeId = resolveScopeId(scopeType, rawScopeId);
  const rows = await kpiRepository.findByScope(scopeType, scopeId);
  return toKpiListResponse(scopeType, scopeId, metricKey ? rows.filter((r) => r.metricKey === metricKey) : rows);
};

const getTrends = async (scopeType, rawScopeId, metricKey) => {
  const scopeId = resolveScopeId(scopeType, rawScopeId);
  const rows = await trendRepository.findByScope(scopeType, scopeId);
  return toTrendListResponse(scopeType, scopeId, metricKey ? rows.filter((r) => r.metricKey === metricKey) : rows);
};

const getForecast = async (scopeType, rawScopeId, metricKey) => {
  const scopeId = resolveScopeId(scopeType, rawScopeId);
  const rows = await forecastRepository.findByScope(scopeType, scopeId, metricKey);
  return toForecastListResponse(scopeType, scopeId, rows);
};

/**
 * Builds and persists the PLATFORM-scoped administrative report for one
 * period. Reports aren't duplicated per course/instructor — Report bundles
 * whatever KPIs/trends/forecasts already exist for a scope, and per-course
 * reporting already has a dedicated home in Teacher Insight's weekly/
 * monthly summary; this agent's Report is the platform-wide admin rollup
 * the spec's "Administrative Reports" section describes.
 *
 * @param {"WEEKLY"|"MONTHLY"|"QUARTERLY"|"ANNUAL"} reportType
 */
const buildAndPersistReport = async (reportType) => {
  const scopeType = SCOPE_TYPE.PLATFORM;
  const scopeId = PLATFORM_SCOPE_ID;
  const now = new Date();
  const periodStart = resolvePeriodStart(reportType, now);

  const [kpis, trends, forecasts] = await Promise.all([
    kpiRepository.findByScope(scopeType, scopeId),
    trendRepository.findByScope(scopeType, scopeId),
    forecastRepository.findByScope(scopeType, scopeId),
  ]);

  const kpiSnapshot = kpis.map((k) => ({ metricKey: k.metricKey, value: k.value, unit: k.unit, trend: k.trend, changePercent: k.changePercent }));
  const trendsSummary = trends.map((t) => ({ metricKey: t.metricKey, direction: t.direction, changePercent: t.changePercent }));
  const forecastsSummary = forecasts.map((f) => ({
    metricKey: f.metricKey,
    forecastDate: f.forecastDate,
    predictedValue: f.predictedValue,
    confidenceScore: f.confidenceScore,
  }));

  const upCount = trends.filter((t) => t.direction === "UP").length;
  const downCount = trends.filter((t) => t.direction === "DOWN").length;
  const summary =
    `Platform ${reportType.toLowerCase()} report, period starting ${periodStart.toISOString().slice(0, 10)}: ` +
    `${kpis.length} KPI(s) tracked, ${upCount} trending up, ${downCount} trending down, ${forecasts.length} forecast(s) available.`;

  const report = await reportRepository.upsertReport(scopeType, scopeId, {
    reportType,
    periodStart,
    periodEnd: now,
    summary,
    kpiSnapshot,
    trends: trendsSummary,
    forecasts: forecastsSummary,
  });

  return report;
};

const getReports = async (reportType) => {
  const rows = await reportRepository.findByScope(SCOPE_TYPE.PLATFORM, PLATFORM_SCOPE_ID, { reportType });
  return toReportListResponse(rows);
};

const getReportForExport = async ({ reportId, reportType }) => {
  if (reportId) {
    const report = await reportRepository.findById(reportId);
    if (!report) throw new ApiError(404, "Report not found");
    return report;
  }

  if (reportType) {
    const rows = await reportRepository.findByScope(SCOPE_TYPE.PLATFORM, PLATFORM_SCOPE_ID, { reportType });
    if (rows.length === 0) throw new ApiError(404, `No ${reportType} report has been generated yet`);
    return rows[0];
  }

  throw new ApiError(400, "reportId or reportType is required");
};

/** POST /analytics/report/export */
const exportReport = async ({ reportId, reportType, format }) => {
  const report = await getReportForExport({ reportId, reportType });
  return writeReportExport(toReportEntry(report), format);
};

module.exports = {
  generateForScope,
  recalculate,
  getDashboard,
  getByStudent,
  getByInstructor,
  getByCourse,
  getPlatform,
  getPlatformKPIs,
  getCourseKPIsBatch,
  getInstructorKPIsBatch,
  getKPIs,
  getTrends,
  getForecast,
  buildAndPersistReport,
  getReports,
  exportReport,
};
