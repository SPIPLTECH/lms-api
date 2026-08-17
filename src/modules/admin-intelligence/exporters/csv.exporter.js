/**
 * Hand-rolled CSV — no CSV/PDF-writer library exists in this repo's
 * dependencies (only csv-parser and pdf-parse, both read-only), same honest
 * gap Analytics' own csv.exporter.js documents; PDF export is not
 * fabricated. Flattens departmentSummary, the one naturally tabular part of
 * an ExecutiveReport, into rows — healthSnapshot/facultySummary/insights/
 * recommendations/alerts/forecasts stay in the JSON export.
 */
const escapeCsvValue = (value) => {
  const str = String(value ?? "");
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
};

const exportCsv = (report) => {
  const headers = ["departmentKey", "courseCount", "activeStudentCount", "averageCompletionRate", "healthScore"];
  const rows = (report.departmentSummary || []).map((d) => [d.departmentKey, d.courseCount, d.activeStudentCount, d.averageCompletionRate, d.healthScore]);
  return [headers, ...rows].map((row) => row.map(escapeCsvValue).join(",")).join("\n");
};

module.exports = { exportCsv };
