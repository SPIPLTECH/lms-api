const test = require("node:test");
const assert = require("node:assert/strict");

const { detect } = require("../../services/domain/detectors/weakConcepts.detector");
const { detect: detectStrong } = require("../../services/domain/detectors/strongConcepts.detector");
const { makeContext } = require("../helpers/makeContext");

test("weakConcepts.detect ignores a concept with too few attempting students", () => {
  const context = makeContext({ assessmentSummary: { masteryRows: [{ studentId: "s1", concept: "algebra", masteryScore: 10 }] } });
  assert.deepEqual(detect(context), []);
});

test("weakConcepts.detect flags a low-average concept with enough students", () => {
  const context = makeContext({
    assessmentSummary: {
      masteryRows: [
        { studentId: "s1", concept: "algebra", masteryScore: 30 },
        { studentId: "s2", concept: "algebra", masteryScore: 40 },
      ],
    },
  });
  const [candidate] = detect(context);
  assert.equal(candidate.insightType, "WEAK_CONCEPT");
  assert.equal(candidate.dedupeKey, "algebra");
  assert.equal(candidate.affectedStudentCount, 2);
});

test("weakConcepts.detect ignores a concept whose average is above threshold", () => {
  const context = makeContext({
    assessmentSummary: {
      masteryRows: [
        { studentId: "s1", concept: "geometry", masteryScore: 90 },
        { studentId: "s2", concept: "geometry", masteryScore: 85 },
      ],
    },
  });
  assert.deepEqual(detect(context), []);
});

test("strongConcepts.detect flags a high-average concept with enough students", () => {
  const context = makeContext({
    assessmentSummary: {
      masteryRows: [
        { studentId: "s1", concept: "geometry", masteryScore: 90 },
        { studentId: "s2", concept: "geometry", masteryScore: 88 },
      ],
    },
  });
  const [candidate] = detectStrong(context);
  assert.equal(candidate.insightType, "STRONG_CONCEPT");
  assert.equal(candidate.priority, "LOW");
});
