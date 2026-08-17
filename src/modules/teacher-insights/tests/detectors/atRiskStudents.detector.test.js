const test = require("node:test");
const assert = require("node:assert/strict");

const { detect } = require("../../services/domain/detectors/atRiskStudents.detector");
const { makeContext } = require("../helpers/makeContext");

test("atRiskStudents.detect stays silent below the dropout threshold", () => {
  const context = makeContext({ studentStates: [{ studentId: "s1", risk: { dropoutRiskScore: 20, dropoutRiskLevel: "LOW" } }] });
  assert.deepEqual(detect(context), []);
});

test("atRiskStudents.detect flags students at/above the threshold", () => {
  const context = makeContext({ studentStates: [{ studentId: "s1", risk: { dropoutRiskScore: 55, dropoutRiskLevel: "MEDIUM" } }] });
  const [candidate] = detect(context);
  assert.equal(candidate.alertType, "AT_RISK");
  assert.equal(candidate.studentId, "s1");
  assert.equal(candidate.priority, "MEDIUM");
});

test("atRiskStudents.detect marks HIGH priority for HIGH dropout risk level", () => {
  const context = makeContext({ studentStates: [{ studentId: "s1", risk: { dropoutRiskScore: 90, dropoutRiskLevel: "HIGH" } }] });
  const [candidate] = detect(context);
  assert.equal(candidate.priority, "HIGH");
});
