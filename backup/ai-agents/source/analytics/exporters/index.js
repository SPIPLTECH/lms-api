const { EXPORT_FORMAT } = require("../constants");
const { exportJson } = require("./json.exporter");
const { exportCsv } = require("./csv.exporter");

const CONTENT_TYPE_BY_FORMAT = Object.freeze({
  [EXPORT_FORMAT.JSON]: "application/json",
  [EXPORT_FORMAT.CSV]: "text/csv",
});

/**
 * @param {Object} report - DTO-shaped report entry (see dto/analyticsResponse.dto.js#toReportEntry).
 * @param {"JSON"|"CSV"} format
 */
const exportReport = (report, format) => {
  const body = format === EXPORT_FORMAT.CSV ? exportCsv(report) : exportJson(report);
  const datePart = new Date(report.periodStart).toISOString().slice(0, 10);

  return {
    body,
    contentType: CONTENT_TYPE_BY_FORMAT[format],
    filename: `analytics-report-${report.reportType.toLowerCase()}-${datePart}.${format.toLowerCase()}`,
  };
};

module.exports = { exportReport };
