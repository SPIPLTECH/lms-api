const test = require("node:test");
const assert = require("node:assert");

const prisma = require("../src/config/database");
const quizService = require("../src/modules/quizzes/quiz.service");

// The invariants under test, for the qualifying-test hint:
//
//  1. Attempt 1 gets NO hint — not hidden in the UI, absent from the response.
//     The first attempt is what decides whether the student already knows the
//     content, so helping them through it would defeat the test it gates.
//  2. Attempt 2 onward gets the hint text, and the attempt number comes from
//     the submitted QuizAttempt log, so a refresh cannot reset it.
//  3. ONLY a qualifying test. A Self-Test, a Final, or any ordinary lesson
//     quiz never exposes a hint, on any attempt.
//  4. An instructor always sees hints — they author them.

const HINT = "Count the terminals, not the gates.";

const buildQuiz = (overrides = {}) => ({
  id: "quiz-1",
  courseId: "course-1",
  title: "Qualifying Test",
  quizTag: "QUALIFYING",
  lessonId: "lesson-1",
  topicId: null,
  passingScore: 70,
  attempts: 3,
  timeLimit: null,
  isPublished: true,
  quizQuestions: [
    {
      id: "qq-1",
      order: 1,
      marks: 1,
      isMandatory: true,
      question: {
        id: "q1",
        question: "Which gate outputs true only when both inputs are true?",
        questionType: "MCQ_SINGLE",
        options: ["AND", "OR"],
        correctAnswer: "AND",
        explanation: "AND is true only for true/true.",
        hint: HINT,
        marks: 1,
        topic: "logic-gates"
      }
    },
    {
      id: "qq-2",
      order: 2,
      marks: 1,
      isMandatory: true,
      question: {
        id: "q2",
        question: "A question nobody wrote a hint for.",
        questionType: "MCQ_SINGLE",
        options: ["A", "B"],
        correctAnswer: "A",
        explanation: "",
        hint: null,
        marks: 1,
        topic: "logic-gates"
      }
    }
  ],
  ...overrides
});

/**
 * Stubs the two reads getQuizById makes, with `submittedAttempts` standing in
 * for the student's real QuizAttempt log — the same source the attempt number
 * is derived from in production.
 */
function stubQuiz(t, { quiz, submittedAttempts = 0 }) {
  const originals = {
    quizFindUnique: prisma.quiz.findUnique,
    attemptCount: prisma.quizAttempt.count,
    submissionFindUnique: prisma.quizSubmission.findUnique
  };

  t.after(() => {
    prisma.quiz.findUnique = originals.quizFindUnique;
    prisma.quizAttempt.count = originals.attemptCount;
    prisma.quizSubmission.findUnique = originals.submissionFindUnique;
  });

  prisma.quiz.findUnique = async () => quiz;
  prisma.quizAttempt.count = async () => submittedAttempts;
  prisma.quizSubmission.findUnique = async () => null;
}

const questionById = (result, id) => result.questions.find((q) => q.id === id);

// ---------------------------------------------------------------------------
// Attempt 1: withheld
// ---------------------------------------------------------------------------

test("qualifying test, attempt 1 — the hint is absent from the response entirely", async (t) => {
  stubQuiz(t, { quiz: buildQuiz(), submittedAttempts: 0 });

  const result = await quizService.getQuizById("quiz-1", "STUDENT", "student-1");

  assert.strictEqual(result.currentAttemptNumber, 1);
  assert.strictEqual(result.hintsUnlocked, false);

  const q1 = questionById(result, "q1");
  assert.ok(!("hint" in q1), "the hint text must not be sent at all — hiding it client-side would leak it");
  // The student is still told a hint exists, which is not the same as being
  // told what it says.
  assert.strictEqual(q1.hasHint, true);

  // Serializing the whole payload is the real check: nothing anywhere in the
  // response may contain the hint.
  assert.ok(
    !JSON.stringify(result).includes(HINT),
    "the hint text appears nowhere in the attempt-1 payload"
  );
});

test("qualifying test, attempt 1 — the answer key stays withheld too", async (t) => {
  stubQuiz(t, { quiz: buildQuiz(), submittedAttempts: 0 });

  const result = await quizService.getQuizById("quiz-1", "STUDENT", "student-1");
  const q1 = questionById(result, "q1");

  assert.ok(!("correctAnswer" in q1));
  assert.ok(!("explanation" in q1));
});

// ---------------------------------------------------------------------------
// Attempt 2+: available
// ---------------------------------------------------------------------------

test("qualifying test, attempt 2 — the hint is available but not pre-opened", async (t) => {
  stubQuiz(t, { quiz: buildQuiz(), submittedAttempts: 1 });

  const result = await quizService.getQuizById("quiz-1", "STUDENT", "student-1");

  assert.strictEqual(result.currentAttemptNumber, 2);
  assert.strictEqual(result.hintsUnlocked, true);
  assert.strictEqual(questionById(result, "q1").hint, HINT);

  // The server only makes it available. Whether it has been READ is recorded
  // per question on the attempt (hintViewed), and only when the student asks.
  assert.ok(
    !("hintViewed" in questionById(result, "q1")),
    "the quiz payload says nothing about having viewed a hint"
  );

  // The answer key is still not sent — a hint is a nudge, not the answer.
  assert.ok(!("correctAnswer" in questionById(result, "q1")));
});

test("qualifying test, attempt 3 — still available", async (t) => {
  stubQuiz(t, { quiz: buildQuiz(), submittedAttempts: 2 });

  const result = await quizService.getQuizById("quiz-1", "STUDENT", "student-1");

  assert.strictEqual(result.currentAttemptNumber, 3);
  assert.strictEqual(result.hintsUnlocked, true);
  assert.strictEqual(questionById(result, "q1").hint, HINT);
});

test("the attempt number comes from the submitted attempt log, so a refresh can't reset it", async (t) => {
  // Two reads of the same quiz, as a refresh mid-attempt would make: the
  // answer is recomputed from QuizAttempt each time rather than remembered
  // anywhere in the client.
  stubQuiz(t, { quiz: buildQuiz(), submittedAttempts: 1 });

  const first = await quizService.getQuizById("quiz-1", "STUDENT", "student-1");
  const afterRefresh = await quizService.getQuizById("quiz-1", "STUDENT", "student-1");

  assert.strictEqual(first.currentAttemptNumber, 2);
  assert.strictEqual(afterRefresh.currentAttemptNumber, 2);
  assert.strictEqual(afterRefresh.hintsUnlocked, true);
});

test("a question with no hint authored offers nothing, even once hints are unlocked", async (t) => {
  stubQuiz(t, { quiz: buildQuiz(), submittedAttempts: 1 });

  const result = await quizService.getQuizById("quiz-1", "STUDENT", "student-1");
  const q2 = questionById(result, "q2");

  assert.strictEqual(q2.hasHint, false);
  assert.ok(!q2.hint, "no empty hint box to open");
});

// ---------------------------------------------------------------------------
// Every other kind of quiz is untouched
// ---------------------------------------------------------------------------

test("an ordinary quiz never exposes a hint, however many attempts have been made", async (t) => {
  for (const quizTag of ["SELF_TEST", "FINAL"]) {
    for (const submittedAttempts of [0, 1, 5]) {
      const originals = {
        quizFindUnique: prisma.quiz.findUnique,
        attemptCount: prisma.quizAttempt.count,
        submissionFindUnique: prisma.quizSubmission.findUnique
      };
      prisma.quiz.findUnique = async () => buildQuiz({ quizTag });
      prisma.quizAttempt.count = async () => submittedAttempts;
      prisma.quizSubmission.findUnique = async () => null;

      const result = await quizService.getQuizById("quiz-1", "STUDENT", "student-1");

      assert.strictEqual(
        result.hintsUnlocked,
        false,
        `${quizTag} must never unlock hints (after ${submittedAttempts} attempts)`
      );
      assert.ok(
        !JSON.stringify(result).includes(HINT),
        `${quizTag} must not ship hint text (after ${submittedAttempts} attempts)`
      );

      prisma.quiz.findUnique = originals.quizFindUnique;
      prisma.quizAttempt.count = originals.attemptCount;
      prisma.quizSubmission.findUnique = originals.submissionFindUnique;
    }
  }
});

test("an instructor always sees hints — they are the ones writing them", async (t) => {
  stubQuiz(t, { quiz: buildQuiz(), submittedAttempts: 0 });

  const result = await quizService.getQuizById("quiz-1", "INSTRUCTOR", null);

  assert.strictEqual(questionById(result, "q1").hint, HINT);
  assert.strictEqual(questionById(result, "q1").correctAnswer, "AND");
  // No student is attempting this, so there is no attempt to report on.
  assert.strictEqual(result.hintsUnlocked, undefined);
});

test("the raw junction relation is not a back door to the answer key", async (t) => {
  // Regression: the response spread the whole quiz row, and `quizQuestions`
  // on it carries the UNSANITIZED question — so correctAnswer, explanation
  // and hint were all still in the payload, one key over from the sanitized
  // `questions` array they had just been stripped from.
  stubQuiz(t, { quiz: buildQuiz(), submittedAttempts: 0 });

  const result = await quizService.getQuizById("quiz-1", "STUDENT", "student-1");

  assert.ok(!("quizQuestions" in result), "the raw relation is not sent to students");
  assert.ok(!JSON.stringify(result).includes("AND is true only for"), "no explanation anywhere");
  assert.ok(!JSON.stringify(result).includes(HINT), "no hint anywhere");

  // The sanitized set is still there, and still complete.
  assert.strictEqual(result.questions.length, 2);
  assert.strictEqual(result.questions[0].question, "Which gate outputs true only when both inputs are true?");
  assert.deepStrictEqual(result.questions[0].options, ["AND", "OR"]);
});

test("an instructor still gets the raw relation the composer reads", async (t) => {
  stubQuiz(t, { quiz: buildQuiz(), submittedAttempts: 0 });

  const result = await quizService.getQuizById("quiz-1", "INSTRUCTOR", null);

  assert.ok(Array.isArray(result.quizQuestions), "instructor tooling is unaffected");
  assert.strictEqual(result.quizQuestions.length, 2);
});

test("a guest gets neither the hint nor the answer key", async (t) => {
  stubQuiz(t, { quiz: buildQuiz(), submittedAttempts: 0 });

  const result = await quizService.getQuizById("quiz-1", "GUEST", null);

  assert.ok(!JSON.stringify(result).includes(HINT));
  assert.ok(!("correctAnswer" in questionById(result, "q1")));
});

// ---------------------------------------------------------------------------
// Viewing a hint is recorded on the existing question-attempt record
// ---------------------------------------------------------------------------

test("hintViewed rides the existing question-attempt tracking, not a new store", () => {
  const quiz = buildQuiz();
  const result = quizService.calculateSubmissionResult(quiz, [{ questionId: "q1", answer: "AND" }]);

  const rows = quizService.buildQuestionAttemptRows(result, [
    { questionId: "q1", visited: true, hintViewed: true },
    { questionId: "q2", visited: true }
  ]);

  const byId = new Map(rows.map((row) => [row.questionId, row]));
  assert.strictEqual(byId.get("q1").hintViewed, true, "recorded on the same row as the answer");
  assert.strictEqual(byId.get("q2").hintViewed, false);
  assert.strictEqual(rows.length, 2, "no extra records are created for a hint");

  // And it is summarized from those rows like everything else.
  assert.strictEqual(quizService.summarizeQuestionAttempts(rows).hintViewedCount, 1);
});
