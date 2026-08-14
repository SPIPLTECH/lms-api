const test = require("node:test");
const assert = require("node:assert/strict");

const { detect } = require("../../services/domain/detectors/strugglingStudents.detector");
const { makeContext } = require("../helpers/makeContext");

test("strugglingStudents.detect stays silent with too few open gaps", () => {
  const context = makeContext({ assessmentSummary: { openGaps: [{ studentId: "s1", concept: "a", severity: 60 }] } });
  assert.deepEqual(detect(context), []);
});

test("strugglingStudents.detect stays silent when severity is low despite multiple gaps", () => {
  const context = makeContext({
    assessmentSummary: {
      openGaps: [
        { studentId: "s1", concept: "a", severity: 10 },
        { studentId: "s1", concept: "b", severity: 10 },
      ],
    },
  });
  assert.deepEqual(detect(context), []);
});

test("strugglingStudents.detect flags a student with multiple severe open gaps", () => {
  const context = makeContext({
    assessmentSummary: {
      openGaps: [
        { studentId: "s1", concept: "a", severity: 50 },
        { studentId: "s1", concept: "b", severity: 60 },
      ],
    },
  });
  const [candidate] = detect(context);
  assert.equal(candidate.alertType, "STRUGGLING");
  assert.equal(candidate.studentId, "s1");
  assert.equal(candidate.evidence.avgSeverity, 55);
});

test("strugglingStudents.detect groups gaps independently per student", () => {
  const context = makeContext({
    assessmentSummary: {
      openGaps: [
        { studentId: "s1", concept: "a", severity: 50 },
        { studentId: "s1", concept: "b", severity: 60 },
        { studentId: "s2", concept: "a", severity: 90 },
      ],
    },
  });
  const candidates = detect(context);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].studentId, "s1");
});
