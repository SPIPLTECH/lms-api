const test = require("node:test");
const assert = require("node:assert/strict");

const { detect } = require("../../services/domain/detectors/topPerformers.detector");
const { makeContext } = require("../helpers/makeContext");

test("topPerformers.detect requires both high performance and engagement", () => {
  const context = makeContext({
    studentStates: [{ studentId: "s1", scores: { performanceScore: 90, engagementScore: 40 }, risk: { dropoutRiskScore: 0 } }],
  });
  assert.deepEqual(detect(context), []);
});

test("topPerformers.detect excludes a student with elevated dropout risk despite high scores", () => {
  const context = makeContext({
    studentStates: [{ studentId: "s1", scores: { performanceScore: 90, engagementScore: 90 }, risk: { dropoutRiskScore: 50 } }],
  });
  assert.deepEqual(detect(context), []);
});

test("topPerformers.detect flags a student excelling on all three fronts", () => {
  const context = makeContext({
    studentStates: [{ studentId: "s1", scores: { performanceScore: 90, engagementScore: 90 }, risk: { dropoutRiskScore: 5 } }],
  });
  const [candidate] = detect(context);
  assert.equal(candidate.alertType, "TOP_PERFORMER");
  assert.equal(candidate.priority, "LOW");
});
