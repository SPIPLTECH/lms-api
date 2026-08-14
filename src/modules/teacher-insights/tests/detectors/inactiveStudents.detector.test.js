const test = require("node:test");
const assert = require("node:assert/strict");

const { detect } = require("../../services/domain/detectors/inactiveStudents.detector");
const { makeContext } = require("../helpers/makeContext");

const NOW = new Date("2026-01-10T00:00:00.000Z");
const daysAgo = (d) => new Date(NOW.getTime() - d * 24 * 3600 * 1000);

test("inactiveStudents.detect stays silent when recently active", () => {
  const context = makeContext({ now: NOW, studentStates: [{ studentId: "s1", engagement: { lastActiveAt: daysAgo(1) } }] });
  assert.deepEqual(detect(context), []);
});

test("inactiveStudents.detect flags a student idle past the threshold", () => {
  const context = makeContext({ now: NOW, studentStates: [{ studentId: "s1", engagement: { lastActiveAt: daysAgo(5) } }] });
  const [candidate] = detect(context);
  assert.equal(candidate.alertType, "INACTIVE");
  assert.equal(candidate.priority, "MEDIUM");
});

test("inactiveStudents.detect escalates to HIGH priority when very idle", () => {
  const context = makeContext({ now: NOW, studentStates: [{ studentId: "s1", engagement: { lastActiveAt: daysAgo(15) } }] });
  const [candidate] = detect(context);
  assert.equal(candidate.priority, "HIGH");
});

test("inactiveStudents.detect skips students with no engagement record yet", () => {
  const context = makeContext({ now: NOW, studentStates: [{ studentId: "s1", engagement: {} }] });
  assert.deepEqual(detect(context), []);
});
