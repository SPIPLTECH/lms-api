const test = require("node:test");
const assert = require("node:assert/strict");

const { extractEvidence, extractOverallScore, classifyEvidenceType } = require("../services/domain/evidenceExtractor");
const { EVENT_TYPES } = require("../constants");
const { makeEvent } = require("./helpers/makeEvent");

test("extractEvidence prefers a per-concept conceptScores breakdown", () => {
  const event = makeEvent({ payload: { conceptScores: { algebra: 0.8, geometry: 0.4 } } });
  const evidence = extractEvidence(event);

  assert.equal(evidence.length, 2);
  const algebra = evidence.find((e) => e.concept === "algebra");
  assert.equal(algebra.scorePercent, 80);
});

test("extractEvidence falls back to a single payload.concept tag when no breakdown exists", () => {
  const event = makeEvent({
    eventType: EVENT_TYPES.ASSIGNMENT_SUBMITTED,
    payload: { concept: "recursion", scorePercent: 70 },
  });
  const evidence = extractEvidence(event);

  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].concept, "recursion");
  assert.equal(evidence[0].scorePercent, 70);
});

test("extractEvidence returns nothing when the payload has no concept information", () => {
  const event = makeEvent({ payload: { percentage: 90 } });
  assert.deepEqual(extractEvidence(event), []);
});

test("extractOverallScore derives from score/totalMarks when percentage is absent", () => {
  const event = makeEvent({ payload: { score: 7, totalMarks: 10 } });
  assert.equal(extractOverallScore(event), 70);
});

test("classifyEvidenceType detects CODING via the payload.exerciseType discriminator", () => {
  const event = makeEvent({ payload: { exerciseType: "CODING" } });
  assert.equal(classifyEvidenceType(event), "CODING");
});

test("classifyEvidenceType falls back to ASSIGNMENT/QUIZ based on eventType", () => {
  assert.equal(classifyEvidenceType(makeEvent({ eventType: EVENT_TYPES.ASSIGNMENT_SUBMITTED, payload: {} })), "ASSIGNMENT");
  assert.equal(classifyEvidenceType(makeEvent({ eventType: EVENT_TYPES.QUIZ_COMPLETED, payload: {} })), "QUIZ");
});
