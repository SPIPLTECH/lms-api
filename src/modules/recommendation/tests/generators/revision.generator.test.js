const test = require("node:test");
const assert = require("node:assert/strict");

const { generate } = require("../../services/domain/generators/revision.generator");
const { makeContext } = require("../helpers/makeContext");

test("revision.generate returns nothing when there are no open knowledge gaps", () => {
  const context = makeContext();
  assert.deepEqual(generate(context), []);
});

test("revision.generate emits one REVIEW_WEAK_TOPICS candidate per open gap", () => {
  const context = makeContext({
    assessment: {
      knowledgeGaps: {
        gaps: [
          { concept: "algebra", severity: 40, detectedAt: new Date() },
          { concept: "geometry", severity: 70, detectedAt: new Date() },
        ],
      },
      recommendations: { recommendations: [] },
    },
  });

  const candidates = generate(context);
  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].type, "REVIEW_WEAK_TOPICS");
  assert.deepEqual(
    candidates.map((c) => c.dedupeKey).sort(),
    ["algebra", "geometry"]
  );
});

test("revision.generate derives urgency directly from gap severity", () => {
  const context = makeContext({
    assessment: { knowledgeGaps: { gaps: [{ concept: "recursion", severity: 65 }] }, recommendations: { recommendations: [] } },
  });

  const [candidate] = generate(context);
  assert.equal(candidate.urgency, 65);
});
