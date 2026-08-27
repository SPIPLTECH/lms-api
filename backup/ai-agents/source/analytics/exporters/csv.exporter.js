/**
 * Hand-rolled CSV — no CSV/PDF-writer library exists in this repo's
 * dependencies (only csv-parser and pdf-parse, both read-only), so PDF
 * export is an honest gap, not fabricated. Flattens kpiSnapshot, the one
 * naturally tabular part of a Report, into rows.
 */
const escapeCsvValue = (value) => {
  const str = String(value ?? "");
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
};

const exportCsv = (report) => {
  const headers = ["metricKey", "value", "unit", "trend", "changePercent"];
  const rows = (report.kpiSnapshot || []).map((k) => [k.metricKey, k.value, k.unit || "", k.trend || "", k.changePercent ?? ""]);
  return [headers, ...rows].map((row) => row.map(escapeCsvValue).join(",")).join("\n");
};

module.exports = { exportCsv };
