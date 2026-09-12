const test = require("node:test");
const assert = require("node:assert");

const courseImporterService = require("../src/modules/course-import/services/courseImporter.service");
const prisma = require("../src/config/database");

// normalizeCorrectAnswer is a private closure inside applyAiEntity (courseImporter.service.js),
// so — same style as quiz-tag.test.js — it's exercised through the public service function
// with Prisma stubbed, rather than imported directly.

const stubTransaction = (captured) => async (fn) => {
  const tx = {
    quiz: { createMany: async ({ data }) => { captured.quizzes = data; } },
    question: { createMany: async ({ data }) => { captured.questions = data; } },
    quizQuestion: { createMany: async ({ data }) => { captured.quizQuestions = data; } },
    content: { createMany: async () => {} },
  };
  return fn(tx);
};

test("applyAiEntity (QUIZ scope) — a question with no correct answer is skipped, never option 1", async (t) => {
  const original = prisma.$transaction;
  t.after(() => {
    prisma.$transaction = original;
  });

  const captured = { questions: [], quizQuestions: [] };
  prisma.$transaction = stubTransaction(captured);

  const generatedData = {
    title: "AI Quiz",
    questions: [
      { question: "Has a key", options: ["A", "B", "C", "D"], correctAnswer: "B" },
      { question: "Missing key entirely", options: ["A", "B", "C", "D"] },
      { question: "Empty string key", options: ["A", "B", "C", "D"], correctAnswer: "" },
      { question: "Null key", options: ["A", "B", "C", "D"], correctAnswer: null },
    ],
  };

  const result = await courseImporterService.applyAiEntity({
    scope: "QUIZ",
    generatedData,
    context: { courseId: "c1" },
    instructorId: "instructor-1",
  });

  assert.strictEqual(captured.questions.length, 1, "only the question with a real key is persisted");
  assert.strictEqual(captured.questions[0].question, "Has a key");
  assert.strictEqual(captured.questions[0].correctAnswer, "B");

  assert.strictEqual(captured.quizQuestions.length, 1);
  assert.strictEqual(captured.quizQuestions[0].order, 1);

  assert.strictEqual(result.skippedQuestionCount, 3);
});

test("applyAiEntity (QUIZ scope) — MCQ_MULTI with no keys is skipped, not defaulted to [options[0]]", async (t) => {
  const original = prisma.$transaction;
  t.after(() => {
    prisma.$transaction = original;
  });

  const captured = { questions: [], quizQuestions: [] };
  prisma.$transaction = stubTransaction(captured);

  const generatedData = {
    title: "AI Quiz",
    questions: [
      {
        question: "Multi with keys",
        questionType: "MCQ_MULTI",
        options: ["A", "B", "C", "D"],
        correctAnswer: ["A", "C"],
      },
      {
        question: "Multi with no keys",
        questionType: "MCQ_MULTI",
        options: ["A", "B", "C", "D"],
        correctAnswer: [],
      },
    ],
  };

  const result = await courseImporterService.applyAiEntity({
    scope: "QUIZ",
    generatedData,
    context: { courseId: "c1" },
    instructorId: "instructor-1",
  });

  assert.strictEqual(captured.questions.length, 1);
  assert.deepStrictEqual(captured.questions[0].correctAnswer, ["A", "C"]);
  assert.strictEqual(result.skippedQuestionCount, 1);
});

test("applyAiEntity (QUIZ scope, existing quiz) — a question with no correct answer is skipped", async (t) => {
  const original = prisma.$transaction;
  t.after(() => {
    prisma.$transaction = original;
  });

  const captured = { questions: [], quizQuestions: [] };
  prisma.$transaction = async (fn) => {
    const tx = {
      quiz: {
        findUnique: async () => ({ id: "q1", courseId: "c1", moduleId: null }),
      },
      question: { createMany: async ({ data }) => { captured.questions = data; } },
      quizQuestion: {
        count: async () => 0,
        createMany: async ({ data }) => { captured.quizQuestions = data; },
      },
    };
    return fn(tx);
  };

  const generatedData = {
    questions: [
      { question: "Missing key", options: ["A", "B", "C", "D"] },
      { question: "Has a key", options: ["A", "B", "C", "D"], correctAnswer: "C" },
    ],
  };

  const result = await courseImporterService.applyAiEntity({
    scope: "QUIZ",
    generatedData,
    context: { existingQuizId: "q1" },
    instructorId: "instructor-1",
  });

  assert.strictEqual(captured.questions.length, 1);
  assert.strictEqual(captured.questions[0].question, "Has a key");
  assert.strictEqual(captured.questions[0].correctAnswer, "C");
  assert.strictEqual(captured.quizQuestions[0].order, 1);
  assert.strictEqual(result.skippedQuestionCount, 1);
});
