const toKpiEntry = (kpi) => ({
  metricKey: kpi.metricKey,
  value: kpi.value,
  unit: kpi.unit,
  trend: kpi.trend,
  changePercent: kpi.changePercent,
  metadata: kpi.metadata,
  version: kpi.version,
  lastCalculatedAt: kpi.lastCalculatedAt,
});

const toTrendEntry = (trend) => ({
  metricKey: trend.metricKey,
  direction: trend.direction,
  changePercent: trend.changePercent,
  currentValue: trend.currentValue,
  previousValue: trend.previousValue,
  windowDays: trend.windowDays,
  computedAt: trend.computedAt,
});

const toForecastEntry = (forecast) => ({
  metricKey: forecast.metricKey,
  forecastDate: forecast.forecastDate,
  predictedValue: forecast.predictedValue,
  confidenceScore: forecast.confidenceScore,
  method: forecast.method,
  basedOnDataPoints: forecast.basedOnDataPoints,
  computedAt: forecast.computedAt,
});

const toReportEntry = (report) => ({
  id: report.id,
  scopeType: report.scopeType,
  scopeId: report.scopeId,
  reportType: report.reportType,
  periodStart: report.periodStart,
  periodEnd: report.periodEnd,
  summary: report.summary,
  kpiSnapshot: report.kpiSnapshot,
  trends: report.trends,
  forecasts: report.forecasts,
  version: report.version,
  generatedAt: report.generatedAt,
});

/** GET /analytics/dashboard, /student/:id, /instructor/:id, /course/:id, /platform — a full scope snapshot in one document. */
const toScopeSnapshotResponse = (scopeType, scopeId, { kpis, trends, dashboardMetrics }) => {
  const dashboards = {};
  for (const metric of dashboardMetrics) dashboards[metric.dashboardKey] = metric.data;

  return {
    scopeType,
    scopeId,
    kpis: kpis.map(toKpiEntry),
    trends: trends.map(toTrendEntry),
    dashboards,
  };
};

/** GET /analytics/kpis */
const toKpiListResponse = (scopeType, scopeId, rows) => ({
  scopeType,
  scopeId,
  count: rows.length,
  kpis: rows.map(toKpiEntry),
});

/** GET /analytics/trends */
const toTrendListResponse = (scopeType, scopeId, rows) => ({
  scopeType,
  scopeId,
  count: rows.length,
  trends: rows.map(toTrendEntry),
});

/** GET /analytics/forecast */
const toForecastListResponse = (scopeType, scopeId, rows) => ({
  scopeType,
  scopeId,
  count: rows.length,
  forecasts: rows.map(toForecastEntry),
});

/** GET /analytics/reports */
const toReportListResponse = (rows) => ({
  count: rows.length,
  reports: rows.map(toReportEntry),
});

/** POST /analytics/recalculate */
const toRecalculateResponse = (result) => ({
  scopeType: result.scopeType,
  scopeId: result.scopeId,
  metricsGenerated: result.metricsGenerated,
  trendsGenerated: result.trendsGenerated,
  forecastsGenerated: result.forecastsGenerated,
});

module.exports = {
  toKpiEntry,
  toTrendEntry,
  toForecastEntry,
  toReportEntry,
  toScopeSnapshotResponse,
  toKpiListResponse,
  toTrendListResponse,
  toForecastListResponse,
  toReportListResponse,
  toRecalculateResponse,
};
