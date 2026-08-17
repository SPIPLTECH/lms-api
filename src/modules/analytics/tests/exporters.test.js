const test = require("node:test");
const assert = require("node:assert/strict");

const { exportReport } = require("../exporters");

const sampleReport = {
  reportType: "WEEKLY",
  periodStart: new Date("2026-07-27T00:00:00.000Z"),
  kpiSnapshot: [
    { metricKey: "ACTIVE_USERS", value: 120, unit: "count", trend: "UP", changePercent: 12.5 },
    { metricKey: "CHURN", value: 4, unit: "%", trend: "DOWN", changePercent: -2 },
  ],
};

test("exportReport JSON round-trips the shaped report", () => {
  const { body, contentType, filename } = exportReport(sampleReport, "JSON");
  assert.equal(contentType, "application/json");
  assert.equal(filename, "analytics-report-weekly-2026-07-27.json");
  assert.deepEqual(JSON.parse(body), JSON.parse(JSON.stringify(sampleReport)));
});

test("exportReport CSV flattens kpiSnapshot into one row per metric", () => {
  const { body, contentType } = exportReport(sampleReport, "CSV");
  assert.equal(contentType, "text/csv");
  const lines = body.split("\n");
  assert.equal(lines.length, 3); // header + 2 metrics
  assert.equal(lines[0], "metricKey,value,unit,trend,changePercent");
  assert.equal(lines[1], "ACTIVE_USERS,120,count,UP,12.5");
});

test("exportReport CSV handles a report with no kpiSnapshot gracefully", () => {
  const { body } = exportReport({ reportType: "MONTHLY", periodStart: new Date(), kpiSnapshot: [] }, "CSV");
  assert.equal(body.split("\n").length, 1); // header only
});

test("exportReport CSV escapes values containing commas", () => {
  const report = { ...sampleReport, kpiSnapshot: [{ metricKey: "FEATURE_USAGE", value: 5, unit: "a,b", trend: "STABLE", changePercent: 0 }] };
  const { body } = exportReport(report, "CSV");
  assert.match(body, /"a,b"/);
});
