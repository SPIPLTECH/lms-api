const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const prisma = require("../src/config/database");
const quizService = require("../src/modules/quizzes/quiz.service");
const QuestionUploadParser = require("../src/modules/questions/services/QuestionUploadParser");
const { previewFile } = require("../src/modules/questions/question.import.service");
const { normalizeQuestion } = require("../src/utils/helpers/question.helper");
const { validateQuestion } = require("../src/utils/helpers/questionValidator");

// The invariants under test:
//
//  1. Options that differ only by case are different answers. "int float"
//     (a keyword — wrong) and "int Float" (a legal name — right) must never be
//     confused by import, validation or grading.
//  2. An imported file gives the answer as the option's number (1 for the
//     first option) or letter, and a number means a position even when the
//     options are themselves numbers.
//  3. An answer that names no option is reported, never replaced by a guess.

const DECLARATIONS = ["int float = 4;", "int 2ndYear = 4;", "int roll# = 4;", "int Float = 4;"];
const PRIMES = ["2", "4", "5", "9"];

const previewRows = async (t, rows) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "answer-key-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "q.json");
  fs.writeFileSync(file, JSON.stringify(rows));
  return (await previewFile({ path: file, size: fs.statSync(file).size, originalname: "q.json" })).questions;
};

// ---------------------------------------------------------------------------
// Composer import (file → preview)
// ---------------------------------------------------------------------------

test("import — the answer by number, letter or exact text all pick the right case", async (t) => {
  const questions = await previewRows(t, [
    { question: "By number", options: DECLARATIONS, correctAnswer: 4 },
    { question: "By letter", options: DECLARATIONS, correctAnswer: "D" },
    { question: "By exact text", options: DECLARATIONS, correctAnswer: "int Float = 4;" },
    { question: "By the other text", options: DECLARATIONS, correctAnswer: "int float = 4;" },
  ]);

  assert.deepStrictEqual(
    questions.map((q) => q.correctAnswer),
    ["int Float = 4;", "int Float = 4;", "int Float = 4;", "int float = 4;"]
  );
  questions.forEach((q) => assert.deepStrictEqual(q.problems, []));
});

test("import — a number is a position even when the options are numbers", async (t) => {
  const [single, multi, multiCell] = await previewRows(t, [
    { question: "Single", options: PRIMES, correctAnswer: 2 },
    { question: "Multi", type: "MCQ_MULTI", options: PRIMES, correctAnswer: [1, 3] },
    { question: "Multi cell", type: "MCQ_MULTI", options: PRIMES, correctAnswer: "1;3" },
  ]);

  assert.strictEqual(single.correctAnswer, "4", "option 2 is 4, not the text 2");
  assert.deepStrictEqual(multi.correctAnswer, ["2", "5"]);
  assert.deepStrictEqual(multiCell.correctAnswer, ["2", "5"]);
});

test("import — positions beyond 8 work, and a number naming no option is said plainly", async (t) => {
  const [ten, tooBig, zero] = await previewRows(t, [
    { question: "Ten", options: ["o1", "o2", "o3", "o4", "o5", "o6", "o7", "o8", "o9", "o10"], correctAnswer: 10 },
    { question: "Too big", options: ["a", "b", "c", "d"], correctAnswer: 5 },
    { question: "Zero", options: ["a", "b"], correctAnswer: 0 },
  ]);

  assert.strictEqual(ten.correctAnswer, "o10");
  assert.deepStrictEqual(tooBig.problems, ["Correct answer 5 is not an option number — this question has 4 options."]);
  assert.deepStrictEqual(zero.problems, ["Correct answer 0 is not an option number — this question has 2 options."]);
});

test("import — text with only the case wrong still finds the one option it can mean", async (t) => {
  const [unique] = await previewRows(t, [{ question: "Capital?", options: ["Paris", "Rome"], correctAnswer: "paris" }]);
  assert.strictEqual(unique.correctAnswer, "Paris");
});

test("a key saved from the editor is read as text — an option that is a number stays itself", () => {
  // The composer saves the option's text; "2" here is the option "2", not
  // the second option.
  const q = normalizeQuestion({ question: "Primes?", options: PRIMES, correctAnswer: ["2", "5"] });
  assert.deepStrictEqual(q.correctAnswer, ["2", "5"]);
});

test("validation tells options apart by case", () => {
  const right = validateQuestion({ question: "q", questionType: "MCQ", options: DECLARATIONS, correctAnswer: "int Float = 4;", marks: 1 });
  const missing = validateQuestion({ question: "q", questionType: "MCQ", options: ["a", "b"], correctAnswer: "A", marks: 1 });
  assert.deepStrictEqual(right.errors, []);
  assert.deepStrictEqual(missing.errors, ['Correct answer "A" does not exist in options.']);
});

// ---------------------------------------------------------------------------
// Grading
// ---------------------------------------------------------------------------

const score = (questionType, correctAnswer, answer, options = DECLARATIONS) =>
  quizService.calculateSubmissionResult(
    { passingScore: 0, quizQuestions: [{ marks: 1, question: { id: "q1", questionType, options, correctAnswer } }] },
    [{ questionId: "q1", answer }]
  ).score;

test("grading — the wrong-case option scores nothing", () => {
  assert.strictEqual(score("MCQ", "int Float = 4;", "int Float = 4;"), 1);
  assert.strictEqual(score("MCQ", "int Float = 4;", "int float = 4;"), 0);
  assert.strictEqual(score("MCQ_SINGLE", ["int Float = 4;"], "int float = 4;"), 0, "a one-item list key too");
  assert.strictEqual(score("MULTIPLE_CORRECT", ["A", "b"], ["a", "b"], ["A", "a", "b"]), 0);
  assert.strictEqual(score("MULTIPLE_CORRECT", ["A", "b"], ["A", "b"], ["A", "a", "b"]), 1);
});

test("grading — spaces around an option don't matter; a typed answer still ignores case", () => {
  assert.strictEqual(score("MCQ", "  int Float = 4; ", "int Float = 4;"), 1);
  assert.strictEqual(score("FILL_BLANK", "Paris", "paris", []), 1);
});

test("a wrong-case pick is tied to its own option for misconception tagging", () => {
  const tagged = [
    { optionText: "int float = 4;", misconceptionTag: "TERMINOLOGY_CONFUSION" },
    "int 2ndYear = 4;",
    "int roll# = 4;",
    "int Float = 4;",
  ];
  const evidence = quizService.calculateSubmissionResult(
    { passingScore: 0, quizQuestions: [{ marks: 1, question: { id: "q1", questionType: "MCQ", options: tagged, correctAnswer: "int Float = 4;" } }] },
    [{ questionId: "q1", answer: "int float = 4;" }]
  ).questionEvidence[0];
  assert.strictEqual(evidence.misconceptionTag, "TERMINOLOGY_CONFUSION");
});

// ---------------------------------------------------------------------------
// Question Repository upload
// ---------------------------------------------------------------------------

const upload = async (t, rows) => {
  const originals = { questions: prisma.question.findMany, courses: prisma.course.findMany };
  t.after(() => {
    prisma.question.findMany = originals.questions;
    prisma.course.findMany = originals.courses;
  });
  prisma.question.findMany = async () => [];
  prisma.course.findMany = async () => [];
  return QuestionUploadParser.parseAndValidate(Buffer.from(JSON.stringify(rows)), "q.json", "inst-1", { id: "inst-1", role: "INSTRUCTOR" });
};

test("repository upload — number, letter and text (with its own ;) all pick the right case", async (t) => {
  const report = await upload(t, [
    { question: "Number", type: "MCQ_SINGLE", options: DECLARATIONS, correctAnswer: 4 },
    { question: "Letter", type: "MCQ_SINGLE", options: DECLARATIONS, correctAnswer: "D" },
    { question: "Text", type: "MCQ_SINGLE", options: DECLARATIONS, correctAnswer: "int Float = 4;" },
    { question: "Primes", type: "MCQ_MULTI", options: PRIMES, correctAnswer: "1;3" },
    { question: "Out-of-range number that is an option's text", type: "MCQ_SINGLE", options: ["201", "200", "404"], correctAnswer: "201" },
  ]);

  assert.deepStrictEqual(
    report.validQuestions.map((q) => q.correctAnswer),
    [["int Float = 4;"], ["int Float = 4;"], ["int Float = 4;"], ["2", "5"], ["201"]]
  );
});

test("repository upload — an answer naming no option is an error, never 'option 1 by default'", async (t) => {
  const report = await upload(t, [
    { question: "Bad", type: "MCQ_SINGLE", options: ["a", "b"], correctAnswer: "z" },
    { question: "None", type: "MCQ_SINGLE", options: ["a", "b"] },
  ]);

  assert.strictEqual(report.validQuestions.length, 0);
  assert.deepStrictEqual(
    report.errors.map((e) => e.code),
    ["CORRECT_ANSWER_NOT_AN_OPTION", "CORRECT_ANSWER_NOT_AN_OPTION"]
  );
});
