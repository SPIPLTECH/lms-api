const test = require("node:test");
const assert = require("node:assert/strict");

const { evaluateAnswers, deriveKnowledgeLevel, computeConfidenceScore } = require("../services/domain/entryAssessmentEvaluator");

const makeQuestion = (overrides = {}) => ({
  id: "q1",
  concept: "Variables",
  moduleId: "mod1",
  difficulty: "EASY",
  correctAnswerIndex: 0,
  ...overrides,
});

test("deriveKnowledgeLevel buckets at the configured thresholds", () => {
  assert.equal(deriveKnowledgeLevel(0), "BEGINNER");
  assert.equal(deriveKnowledgeLevel(39.9), "BEGINNER");
  assert.equal(deriveKnowledgeLevel(40), "INTERMEDIATE");
  assert.equal(deriveKnowledgeLevel(74.9), "INTERMEDIATE");
  assert.equal(deriveKnowledgeLevel(75), "ADVANCED");
  assert.equal(deriveKnowledgeLevel(100), "ADVANCED");
});

test("computeConfidenceScore weights HARD correctness more than EASY", () => {
  const questions = [makeQuestion({ id: "q1", difficulty: "EASY" }), makeQuestion({ id: "q2", difficulty: "HARD" })];

  const easyOnlyCorrect = computeConfidenceScore(questions, { q1: 0, q2: 1 });
  const hardOnlyCorrect = computeConfidenceScore(questions, { q1: 1, q2: 0 });

  assert.ok(hardOnlyCorrect > easyOnlyCorrect);
});

test("computeConfidenceScore is 0 with no questions", () => {
  assert.equal(computeConfidenceScore([], {}), 0);
});

test("evaluateAnswers computes per-concept mastery as percent-correct within that concept", () => {
  const questions = [
    makeQuestion({ id: "q1", concept: "Variables", moduleId: "m1", correctAnswerIndex: 0 }),
    makeQuestion({ id: "q2", concept: "Variables", moduleId: "m1", correctAnswerIndex: 1 }),
    makeQuestion({ id: "q3", concept: "Arrays", moduleId: "m2", correctAnswerIndex: 2 }),
  ];
  const answers = { q1: 0, q2: 0, q3: 2 }; // Variables: 1/2 correct, Arrays: 1/1 correct

  const result = evaluateAnswers(questions, answers);

  const variables = result.conceptScores.find((c) => c.concept === "Variables");
  const arrays = result.conceptScores.find((c) => c.concept === "Arrays");

  assert.equal(variables.masteryScore, 50);
  assert.equal(arrays.masteryScore, 100);
  assert.equal(result.overallScore, Math.round((2 / 3) * 10000) / 100);
});

test("evaluateAnswers never credits an unanswered question as correct", () => {
  const questions = [makeQuestion({ id: "q1", correctAnswerIndex: 0 })];
  const result = evaluateAnswers(questions, {});
  assert.equal(result.overallScore, 0);
  assert.equal(result.conceptScores[0].masteryScore, 0);
});

test("evaluateAnswers splits strong/weak concepts at the configured thresholds", () => {
  const questions = [
    makeQuestion({ id: "q1", concept: "Strong", moduleId: "m1", correctAnswerIndex: 0 }),
    makeQuestion({ id: "q2", concept: "Weak", moduleId: "m2", correctAnswerIndex: 0 }),
  ];
  const result = evaluateAnswers(questions, { q1: 0, q2: 1 }); // Strong: 100%, Weak: 0%

  assert.deepEqual(result.strongConcepts, ["Strong"]);
  assert.deepEqual(result.weakConcepts, ["Weak"]);
});
