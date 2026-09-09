const { QUESTIONS_PER_DIFFICULTY, OPTIONS_PER_QUESTION, ENTRY_DIFFICULTIES } = require("../constants");

class QuestionValidationError extends Error {}

/**
 * Strict structural validation of an LLM-generated question set. Never
 * "fixes" or pads malformed output — a set that fails validation is treated
 * as a failed generation (the caller falls back to the real question bank),
 * never silently accepted with guessed-at gaps.
 *
 * @param {unknown} parsed - the parsed JSON body
 * @param {string[]} allowedConcepts - concept titles the prompt actually offered
 * @returns {{concept: string, difficulty: string, question: string, options: string[], correctAnswerIndex: number, explanation: string}[]}
 */
const validateQuestionSet = (parsed, allowedConcepts) => {
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.questions)) {
    throw new QuestionValidationError("Response is missing a `questions` array");
  }

  const expectedTotal = QUESTIONS_PER_DIFFICULTY * ENTRY_DIFFICULTIES.length;
  if (parsed.questions.length !== expectedTotal) {
    throw new QuestionValidationError(`Expected ${expectedTotal} questions, got ${parsed.questions.length}`);
  }

  const allowedConceptSet = new Set(allowedConcepts.map((c) => c.trim().toLowerCase()));
  const countByDifficulty = { EASY: 0, MEDIUM: 0, HARD: 0 };

  const validated = parsed.questions.map((q, i) => {
    if (!q || typeof q !== "object") throw new QuestionValidationError(`Question ${i} is not an object`);
    if (typeof q.question !== "string" || !q.question.trim()) throw new QuestionValidationError(`Question ${i} missing question text`);
    if (!ENTRY_DIFFICULTIES.includes(q.difficulty)) throw new QuestionValidationError(`Question ${i} has invalid difficulty "${q.difficulty}"`);
    if (!Array.isArray(q.options) || q.options.length !== OPTIONS_PER_QUESTION || q.options.some((o) => typeof o !== "string" || !o.trim())) {
      throw new QuestionValidationError(`Question ${i} does not have exactly ${OPTIONS_PER_QUESTION} valid options`);
    }
    if (!Number.isInteger(q.correctAnswerIndex) || q.correctAnswerIndex < 0 || q.correctAnswerIndex >= OPTIONS_PER_QUESTION) {
      throw new QuestionValidationError(`Question ${i} has an invalid correctAnswerIndex`);
    }
    if (typeof q.explanation !== "string" || !q.explanation.trim()) {
      throw new QuestionValidationError(`Question ${i} missing explanation`);
    }
    if (typeof q.concept !== "string" || !allowedConceptSet.has(q.concept.trim().toLowerCase())) {
      throw new QuestionValidationError(`Question ${i} has concept "${q.concept}" outside the provided concept list`);
    }

    countByDifficulty[q.difficulty] += 1;

    return {
      concept: q.concept.trim(),
      difficulty: q.difficulty,
      question: q.question.trim(),
      options: q.options.map((o) => o.trim()),
      correctAnswerIndex: q.correctAnswerIndex,
      explanation: q.explanation.trim(),
    };
  });

  for (const difficulty of ENTRY_DIFFICULTIES) {
    if (countByDifficulty[difficulty] !== QUESTIONS_PER_DIFFICULTY) {
      throw new QuestionValidationError(
        `Expected ${QUESTIONS_PER_DIFFICULTY} ${difficulty} questions, got ${countByDifficulty[difficulty]}`
      );
    }
  }

  return validated;
};

/** LLM responses occasionally wrap JSON in markdown fences despite instructions — strip before parsing. */
const parseJsonResponse = (text) => {
  const stripped = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  try {
    return JSON.parse(stripped);
  } catch (error) {
    throw new QuestionValidationError(`Response was not valid JSON: ${error.message}`);
  }
};

module.exports = { validateQuestionSet, parseJsonResponse, QuestionValidationError };
