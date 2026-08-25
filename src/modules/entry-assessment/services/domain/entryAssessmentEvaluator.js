const { round2 } = require("../../utils/scoreMath.util");
const {
  KNOWLEDGE_LEVEL_BEGINNER_MAX,
  KNOWLEDGE_LEVEL_INTERMEDIATE_MAX,
  STRONG_CONCEPT_THRESHOLD,
  WEAK_CONCEPT_THRESHOLD,
  CONFIDENCE_DIFFICULTY_WEIGHT,
} = require("../../constants");

/** Overall score (0-100) -> knowledge level. Explicit thresholds, not a model. */
const deriveKnowledgeLevel = (overallScore) => {
  if (overallScore < KNOWLEDGE_LEVEL_BEGINNER_MAX) return "BEGINNER";
  if (overallScore < KNOWLEDGE_LEVEL_INTERMEDIATE_MAX) return "INTERMEDIATE";
  return "ADVANCED";
};

/**
 * Rewards correctness on harder questions more than on easy ones — a
 * student who clears the HARD tier is a more confidently-assessed result
 * than one who only clears EASY, even at the same overall percentage.
 * Deterministic weighted-accuracy formula, not an LLM judgment.
 */
const computeConfidenceScore = (questions, answers) => {
  let earned = 0;
  let possible = 0;

  for (const q of questions) {
    const weight = CONFIDENCE_DIFFICULTY_WEIGHT[q.difficulty] ?? 1;
    possible += weight;
    if (answers[q.id] === q.correctAnswerIndex) earned += weight;
  }

  return possible > 0 ? round2((earned / possible) * 100) : 0;
};

/**
 * Groups questions by concept, scores each against the student's answers,
 * and derives overall score, knowledge level, per-concept mastery, and
 * strong/weak concept lists — a plain percentage-correct rollup per
 * concept, explainable formula, not black-box ML.
 *
 * @param {{id: string, concept: string, moduleId: string|null, difficulty: string, correctAnswerIndex: number}[]} questions
 * @param {Object<string, number>} answers - { [questionId]: selectedOptionIndex }
 */
const evaluateAnswers = (questions, answers) => {
  const byConcept = new Map();

  for (const q of questions) {
    if (!byConcept.has(q.concept)) byConcept.set(q.concept, { concept: q.concept, moduleId: q.moduleId, correct: 0, total: 0 });
    const bucket = byConcept.get(q.concept);
    bucket.total += 1;
    if (answers[q.id] === q.correctAnswerIndex) bucket.correct += 1;
  }

  const conceptScores = [...byConcept.values()].map((bucket) => ({
    concept: bucket.concept,
    moduleId: bucket.moduleId,
    masteryScore: bucket.total > 0 ? round2((bucket.correct / bucket.total) * 100) : 0,
  }));

  const totalCorrect = questions.filter((q) => answers[q.id] === q.correctAnswerIndex).length;
  const overallScore = questions.length > 0 ? round2((totalCorrect / questions.length) * 100) : 0;

  return {
    overallScore,
    knowledgeLevel: deriveKnowledgeLevel(overallScore),
    confidenceScore: computeConfidenceScore(questions, answers),
    conceptScores,
    strongConcepts: conceptScores.filter((c) => c.masteryScore >= STRONG_CONCEPT_THRESHOLD).map((c) => c.concept),
    weakConcepts: conceptScores.filter((c) => c.masteryScore < WEAK_CONCEPT_THRESHOLD).map((c) => c.concept),
  };
};

module.exports = { evaluateAnswers, deriveKnowledgeLevel, computeConfidenceScore };
