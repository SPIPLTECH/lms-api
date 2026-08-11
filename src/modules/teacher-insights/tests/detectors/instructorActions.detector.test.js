const test = require("node:test");
const assert = require("node:assert/strict");

const { detect } = require("../../services/domain/detectors/instructorActions.detector");
const { makeContext } = require("../helpers/makeContext");

test("instructorActions.detect stays silent with no alerts", () => {
  assert.deepEqual(detect(makeContext(), { studentAlerts: [], courseInsights: [] }), []);
});

test("instructorActions.detect suggests check-ins for at-risk students", () => {
  const studentAlerts = [{ alertType: "AT_RISK", studentId: "s1" }];
  const [candidate] = detect(makeContext(), { studentAlerts, courseInsights: [] });
  assert.equal(candidate.recommendationType, "INSTRUCTOR_ACTION");
  assert.equal(candidate.dedupeKey, "at-risk-checkins");
  assert.equal(candidate.affectedStudentCount, 1);
});

test("instructorActions.detect escalates to HIGH priority with 3+ at-risk students", () => {
  const studentAlerts = [
    { alertType: "AT_RISK", studentId: "s1" },
    { alertType: "AT_RISK", studentId: "s2" },
    { alertType: "AT_RISK", studentId: "s3" },
  ];
  const [candidate] = detect(makeContext(), { studentAlerts, courseInsights: [] });
  assert.equal(candidate.priority, "HIGH");
});

test("instructorActions.detect suggests a review session for multiple struggling students", () => {
  const studentAlerts = [
    { alertType: "STRUGGLING", studentId: "s1" },
    { alertType: "STRUGGLING", studentId: "s2" },
  ];
  const candidates = detect(makeContext(), { studentAlerts, courseInsights: [] });
  assert.ok(candidates.some((c) => c.dedupeKey === "struggling-review-session"));
});
