const test = require("node:test");
const assert = require("node:assert/strict");

const { tryExtractQuizFromRows } = require("../services/extractors/quiz.extractor");

const file = { relativePath: "quiz.json" };

test("tryExtractQuizFromRows returns null for non-question-shaped data", () => {
  assert.equal(tryExtractQuizFromRows({ foo: "bar" }, file), null);
  assert.equal(tryExtractQuizFromRows([{ foo: "bar" }], file), null);
});

test("tryExtractQuizFromRows maps a single-correct-answer MCQ row to a chooseOne block", () => {
  const rows = [{ question: "2+2?", options: ["3", "4", "5"], correctAnswer: "4" }];
  const [block] = tryExtractQuizFromRows(rows, file);

  assert.equal(block.blockType, undefined); // still raw "kind" shape at this stage
  assert.equal(block.kind, "quiz");
  assert.equal(block.answerType, "chooseOne");
  assert.deepEqual(block.correctAnswer, [1]);
});

test("tryExtractQuizFromRows maps a multi-answer row to chooseMultiple", () => {
  const rows = [{ question: "Pick primes", options: ["Two", "Three", "Four"], correctAnswer: ["Two", "Three"] }];
  const [block] = tryExtractQuizFromRows(rows, file);

  assert.equal(block.answerType, "chooseMultiple");
  assert.deepEqual(block.correctAnswer.sort(), [0, 1]);
});

test("tryExtractQuizFromRows falls back to fill-in-the-blanks when the answer doesn't match any option", () => {
  const rows = [{ question: "Capital of France?", options: [], correctAnswer: "Paris" }];
  const [block] = tryExtractQuizFromRows(rows, file);

  assert.equal(block.answerType, "fill-in-the-blanks");
  assert.deepEqual(block.correctAnswer, ["Paris"]);
});

test("tryExtractQuizFromRows accepts a {questions: [...]} wrapper", () => {
  const data = { questions: [{ question: "Q1", options: ["A", "B"], correctAnswer: "A" }] };
  const blocks = tryExtractQuizFromRows(data, file);
  assert.equal(blocks.length, 1);
});
