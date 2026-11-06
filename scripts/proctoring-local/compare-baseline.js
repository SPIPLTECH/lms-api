/**
 * Compares a full test report with the baseline failure list.
 *
 *   node scripts/proctoring-local/compare-baseline.js <report-file> [baseline-file]
 *
 * Prints the totals and any failing test name that is not on the baseline list.
 * Exits 1 when there is one, so a new failure can never pass unnoticed.
 */
const fs = require("fs");
const path = require("path");

const DEFAULT_BASELINE = path.resolve(__dirname, "../../../../Proctoring/docs/integration-baselines/lms-api-failures-with-local-database.txt");

const [reportFile, baselineFile = DEFAULT_BASELINE] = process.argv.slice(2);
const report = fs.readFileSync(reportFile, "utf8");
const baseline = new Set(fs.readFileSync(baselineFile, "utf8").split(/\r?\n/).map((line) => line.trim()).filter(Boolean));

const total = (name) => (report.match(new RegExp(`^. ${name} (\\d+)$`, "m")) || [])[1];
console.log(`tests ${total("tests")}, pass ${total("pass")}, fail ${total("fail")}, skipped ${total("skipped")}`);

const failed = new Set();
const summary = report.slice(Math.max(0, report.indexOf("failing tests:")));
for (const match of summary.matchAll(/^✖ (.+?) \(\d+(?:\.\d+)?ms\)/gm)) failed.add(match[1].trim());

const fresh = [...failed].filter((name) => !baseline.has(name));
console.log(`unique failing names: ${failed.size}; on the baseline: ${failed.size - fresh.length}; new: ${fresh.length}`);
for (const name of fresh) console.log(`NEW FAILURE: ${name}`);
process.exitCode = fresh.length > 0 ? 1 : 0;
