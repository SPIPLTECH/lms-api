const test = require("node:test");
const assert = require("node:assert/strict");

const { detect } = require("../../services/domain/detectors/inactivityAlert.detector");
const { makeContext } = require("../helpers/makeContext");

const NOW = new Date("2026-01-10T00:00:00.000Z");
const daysAgo = (d) => new Date(NOW.getTime() - d * 24 * 3600 * 1000);

test("inactivityAlert.detect stays silent when there's no learning state yet", () => {
  assert.deepEqual(detect(makeContext({ now: NOW }), false), []);
});

test("inactivityAlert.detect stays silent below the medium inactivity threshold", () => {
  const context = makeContext({ now: NOW, learningState: { engagement: { lastActiveAt: daysAgo(1) } } });
  assert.deepEqual(detect(context, false), []);
});

test("inactivityAlert.detect fires MEDIUM priority at the medium threshold", () => {
  const context = makeContext({ now: NOW, learningState: { engagement: { lastActiveAt: daysAgo(3) } } });
  const [candidate] = detect(context, false);
  assert.equal(candidate.type, "INACTIVITY_ALERT");
  assert.equal(candidate.priority, "MEDIUM");
});

test("inactivityAlert.detect fires HIGH priority at the high threshold", () => {
  const context = makeContext({ now: NOW, learningState: { engagement: { lastActiveAt: daysAgo(8) } } });
  const [candidate] = detect(context, false);
  assert.equal(candidate.priority, "HIGH");
});

test("inactivityAlert.detect stays silent when the student is flagged as burned out instead", () => {
  const context = makeContext({ now: NOW, learningState: { engagement: { lastActiveAt: daysAgo(8) } } });
  assert.deepEqual(detect(context, true), []);
});
