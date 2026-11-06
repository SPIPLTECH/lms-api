/**
 * Board-paper question types (SSC Class 10 Test Series).
 *
 * In that course every SubTopic is one board question (or a topic's MCQ's),
 * and its `description` holds the question's type and marks:
 * "Short answer · 2 marks", or "MCQs" for the MCQ's sub-topic. The student
 * player groups a topic's quizzes by these types (the topic quiz picker).
 *
 * Only these exact names are read, so a SubTopic description in any other
 * course is never taken for a type.
 */

const QUESTION_TYPES = Object.freeze([
  "MCQs",
  "Short answer",
  "Descriptive",
  "Activity",
  "Diagrams & graphs",
  "Scientific reasons",
  "Proofs",
]);

const PATTERN = /^(.+?)(?: · (\d+) marks?)?$/;

/**
 * @param {string|null|undefined} description a SubTopic's description
 * @returns {{ type: string, marks: number|null } | null}
 */
function parseQuestionType(description) {
  const match = PATTERN.exec(String(description ?? "").trim());
  if (!match || !QUESTION_TYPES.includes(match[1])) return null;
  return { type: match[1], marks: match[2] ? Number(match[2]) : null };
}

module.exports = { QUESTION_TYPES, parseQuestionType };
