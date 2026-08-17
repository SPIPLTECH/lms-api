const test = require("node:test");
const assert = require("node:assert/strict");

const { validateQuestionSet, parseJsonResponse, QuestionValidationError } = require("../llm/questionValidator");

const CONCEPTS = ["Variables", "Arrays", "Loops"];

const makeQuestion = (concept, difficulty, overrides = {}) => ({
  concept,
  difficulty,
  question: `What about ${concept}?`,
  options: ["A", "B", "C", "D"],
  correctAnswerIndex: 0,
  explanation: "Because A is correct.",
  ...overrides,
});

const makeValidSet = () => {
  const questions = [];
  const concepts = CONCEPTS;
  let conceptIndex = 0;
  for (const difficulty of ["EASY", "MEDIUM", "HARD"]) {
    for (let i = 0; i < 5; i++) {
      questions.push(makeQuestion(concepts[conceptIndex % concepts.length], difficulty));
      conceptIndex += 1;
    }
  }
  return { questions };
};

test("validateQuestionSet accepts a well-formed 5/5/5 set", () => {
  const validated = validateQuestionSet(makeValidSet(), CONCEPTS);
  assert.equal(validated.length, 15);
});

test("validateQuestionSet rejects a response missing the questions array", () => {
  assert.throws(() => validateQuestionSet({}, CONCEPTS), QuestionValidationError);
});

test("validateQuestionSet rejects the wrong total count", () => {
  const set = makeValidSet();
  set.questions.pop();
  assert.throws(() => validateQuestionSet(set, CONCEPTS), QuestionValidationError);
});

test("validateQuestionSet rejects an uneven difficulty distribution", () => {
  const set = makeValidSet();
  set.questions[0].difficulty = "MEDIUM"; // now 4 EASY, 6 MEDIUM, 5 HARD
  assert.throws(() => validateQuestionSet(set, CONCEPTS), QuestionValidationError);
});

test("validateQuestionSet rejects a question with the wrong number of options", () => {
  const set = makeValidSet();
  set.questions[0].options = ["A", "B"];
  assert.throws(() => validateQuestionSet(set, CONCEPTS), QuestionValidationError);
});

test("validateQuestionSet rejects an out-of-range correctAnswerIndex", () => {
  const set = makeValidSet();
  set.questions[0].correctAnswerIndex = 4;
  assert.throws(() => validateQuestionSet(set, CONCEPTS), QuestionValidationError);
});

test("validateQuestionSet rejects a concept outside the provided list", () => {
  const set = makeValidSet();
  set.questions[0].concept = "Quantum Computing";
  assert.throws(() => validateQuestionSet(set, CONCEPTS), QuestionValidationError);
});

test("parseJsonResponse strips markdown code fences before parsing", () => {
  const parsed = parseJsonResponse('```json\n{"questions": []}\n```');
  assert.deepEqual(parsed, { questions: [] });
});

test("parseJsonResponse throws on genuinely invalid JSON", () => {
  assert.throws(() => parseJsonResponse("not json at all"), QuestionValidationError);
});
