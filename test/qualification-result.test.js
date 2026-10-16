const test = require("node:test");
const assert = require("node:assert");

const prisma = require("../src/config/database");
const quizService = require("../src/modules/quizzes/quiz.service");
const {
  summarizeWeakConcepts,
  buildQualificationOutcome
} = require("../src/utils/qualificationResult");

// The invariants under test, for the qualifying-test result experience:
//
//  1. The answer key is NOT handed back while the student can still retake a
//     qualifying test. Otherwise: fail attempt 1, read every correct answer
//     off your own result page, score 100% on attempt 2 — qualification
//     forged through a legitimate endpoint, and the attempt-2 hint rule made
//     pointless because the answers themselves were already given away.
//  2. Once the outcome is settled (passed, or out of attempts) the full
//     review comes back — that is what a result page is for.
//  3. Every ordinary quiz is unaffected.
//  4. The result reports what actually happened, folded from the existing
//     question records: counts, skips, hints, attempt standing, history.

const CORRECT = "AND";
const EXPLANATION = "AND is true only for true/true.";

const buildQuiz = (overrides = {}) => ({
  id: "quiz-1",
  courseId: "course-1",
  title: "Qualifying Test",
  quizTag: "QUALIFYING",
  lessonId: "lesson-1",
  topicId: null,
  passingScore: 70,
  attempts: 3,
  isPublished: true,
  quizQuestions: [
    {
      id: "qq-1",
      order: 1,
      marks: 1,
      question: {
        id: "q1",
        question: "Which gate is true only when both inputs are true?",
        questionType: "MCQ_SINGLE",
        options: ["AND", "OR"],
        correctAnswer: CORRECT,
        explanation: EXPLANATION,
        hint: "Count the terminals.",
        marks: 1,
        topic: "logic-gates"
      }
    }
  ],
  ...overrides
});

/** Stubs the three reads getQuizResult makes. */
function stubResult(t, { quiz, attempts }) {
  const originals = {
    quizFindUnique: prisma.quiz.findUnique,
    attemptFindMany: prisma.quizAttempt.findMany,
    submissionFindUnique: prisma.quizSubmission.findUnique,
    lessonFindUnique: prisma.lesson.findUnique,
    topicFindUnique: prisma.topic.findUnique
  };

  t.after(() => {
    prisma.quiz.findUnique = originals.quizFindUnique;
    prisma.quizAttempt.findMany = originals.attemptFindMany;
    prisma.quizSubmission.findUnique = originals.submissionFindUnique;
    prisma.lesson.findUnique = originals.lessonFindUnique;
    prisma.topic.findUnique = originals.topicFindUnique;
  });

  prisma.quiz.findUnique = async () => quiz;
  prisma.quizAttempt.findMany = async () => attempts;
  prisma.quizSubmission.findUnique = async () => null;
  prisma.lesson.findUnique = async () => ({
    id: "lesson-1",
    title: "Logic Gates",
    moduleId: "m1",
    isPublished: true,
    topics: []
  });
  prisma.topic.findUnique = async () => null;
}

const attempt = (n, { passed = false, percentage = 50, rows = [] } = {}) => ({
  id: `attempt-${n}`,
  attemptNumber: n,
  answers: [{ questionId: "q1", answer: passed ? CORRECT : "OR" }],
  score: passed ? 1 : 0,
  totalMarks: 1,
  percentage,
  passed,
  correctCount: passed ? 1 : 0,
  incorrectCount: passed ? 0 : 1,
  unansweredCount: 0,
  timeTakenSeconds: 95,
  submittedAt: new Date(),
  questionAttempts: rows.length
    ? rows
    : [
        {
          questionId: "q1",
          order: 1,
          answered: true,
          isCorrect: passed,
          skipped: false,
          hintViewed: false,
          question: { topic: "logic-gates" }
        }
      ]
});

const payloadHasKey = (result) => {
  const json = JSON.stringify(result);
  return json.includes(EXPLANATION) || json.includes('"correctAnswer"');
};

// ---------------------------------------------------------------------------
// The answer key while a retake is still possible
// ---------------------------------------------------------------------------

test("qualifying test — a failed attempt with retakes left does NOT return the answer key", async (t) => {
  stubResult(t, { quiz: buildQuiz(), attempts: [attempt(1)] });

  const result = await quizService.getQuizResult("student-1", "quiz-1");

  assert.strictEqual(result.canAttempt, true, "a retake is still available");
  assert.strictEqual(result.answerKeyRevealed, false);
  assert.ok(!("correctAnswer" in result.quiz.questions[0]), "correctAnswer is stripped");
  assert.ok(!("explanation" in result.quiz.questions[0]));
  assert.ok(!("hint" in result.quiz.questions[0]));
  assert.ok(!("quizQuestions" in result.quiz), "and not left in the raw relation either");
  assert.ok(!payloadHasKey(result), "nothing in the payload gives the answers away");

  // What the student is owed IS still there: their own answers and how they did.
  assert.strictEqual(result.percentage, 50);
  assert.strictEqual(result.summary.correctCount, 0);
  assert.strictEqual(result.questionAttempts.length, 1);
  assert.strictEqual(result.questionAttempts[0].isCorrect, false);
});

test("qualifying test — passing releases the answer key", async (t) => {
  stubResult(t, { quiz: buildQuiz(), attempts: [attempt(1), attempt(2, { passed: true, percentage: 100 })] });

  const result = await quizService.getQuizResult("student-1", "quiz-1");

  assert.strictEqual(result.answerKeyRevealed, true, "nothing left to protect once they qualified");
  assert.strictEqual(result.quiz.questions[0].correctAnswer, CORRECT);
});

test("qualifying test — running out of attempts releases the answer key", async (t) => {
  // attempts: 3, all three used and all failed.
  stubResult(t, {
    quiz: buildQuiz(),
    attempts: [attempt(1), attempt(2), attempt(3)]
  });

  const result = await quizService.getQuizResult("student-1", "quiz-1");

  assert.strictEqual(result.canAttempt, false);
  assert.strictEqual(result.answerKeyRevealed, true, "the outcome is settled, so review is safe");
  assert.strictEqual(result.quiz.questions[0].correctAnswer, CORRECT);
});

test("qualifying test — opening an EARLIER attempt still withholds the key", async (t) => {
  // Viewing attempt 1 must not reveal what attempt 2 is about to ask.
  stubResult(t, { quiz: buildQuiz(), attempts: [attempt(1), attempt(2)] });

  const result = await quizService.getQuizResult("student-1", "quiz-1", "attempt-1");

  assert.strictEqual(result.attemptNumber, 1);
  assert.strictEqual(result.isLatestAttempt, false);
  assert.strictEqual(result.answerKeyRevealed, false);
  assert.ok(!payloadHasKey(result));
});

test("an ordinary quiz always returns the full review", async (t) => {
  for (const quizTag of ["SELF_TEST", "FINAL"]) {
    const originals = {
      quizFindUnique: prisma.quiz.findUnique,
      attemptFindMany: prisma.quizAttempt.findMany,
      submissionFindUnique: prisma.quizSubmission.findUnique
    };
    prisma.quiz.findUnique = async () => buildQuiz({ quizTag });
    prisma.quizAttempt.findMany = async () => [attempt(1)];
    prisma.quizSubmission.findUnique = async () => null;

    const result = await quizService.getQuizResult("student-1", "quiz-1");

    assert.strictEqual(result.answerKeyRevealed, true, `${quizTag} review is unchanged`);
    assert.strictEqual(result.quiz.questions[0].correctAnswer, CORRECT);
    assert.strictEqual(result.quiz.questions[0].explanation, EXPLANATION);

    prisma.quiz.findUnique = originals.quizFindUnique;
    prisma.quizAttempt.findMany = originals.attemptFindMany;
    prisma.quizSubmission.findUnique = originals.submissionFindUnique;
  }
});

// ---------------------------------------------------------------------------
// What the result reports
// ---------------------------------------------------------------------------

test("the result reports attempt standing, counts, hints and history", async (t) => {
  const rows = [
    { questionId: "q1", order: 1, answered: true, isCorrect: true, skipped: false, hintViewed: true, question: { topic: "logic-gates" } },
    { questionId: "q2", order: 2, answered: true, isCorrect: false, skipped: false, hintViewed: false, question: { topic: "boolean-algebra" } },
    { questionId: "q3", order: 3, answered: false, isCorrect: null, skipped: true, hintViewed: false, question: { topic: "storage" } }
  ];
  stubResult(t, {
    quiz: buildQuiz(),
    attempts: [attempt(1), attempt(2, { percentage: 58, rows })]
  });

  const { qualification } = await quizService.getQuizResult("student-1", "quiz-1");

  assert.strictEqual(qualification.qualified, false);
  assert.strictEqual(qualification.percentage, 58);
  assert.strictEqual(qualification.passingScore, 70);
  assert.strictEqual(qualification.attemptNumber, 2);
  assert.strictEqual(qualification.maxAttempts, 3);
  assert.strictEqual(qualification.attemptsRemaining, 1);
  assert.strictEqual(qualification.canRetake, true);
  assert.strictEqual(qualification.timeTakenSeconds, 95);
  assert.strictEqual(qualification.hintsUsed, 1);
  assert.deepStrictEqual(qualification.questionBreakdown, {
    total: 3,
    correct: 1,
    incorrect: 1,
    skipped: 1,
    unanswered: 1
  });
  assert.strictEqual(qualification.target.title, "Logic Gates", "the result names what was not skipped");

  // Immutable history of every attempt at this target, oldest first.
  assert.deepStrictEqual(
    qualification.attempts.map((a) => a.attemptNumber),
    [1, 2]
  );
});

test("a pass offers no retake and nothing to review", async (t) => {
  stubResult(t, { quiz: buildQuiz(), attempts: [attempt(1, { passed: true, percentage: 100 })] });

  const { qualification } = await quizService.getQuizResult("student-1", "quiz-1");

  assert.strictEqual(qualification.qualified, true);
  assert.strictEqual(qualification.canRetake, false, "they qualified — there is nothing left to attempt");
  assert.deepStrictEqual(qualification.weakConcepts, []);
  assert.deepStrictEqual(qualification.recommendedContent, []);
});

test("out of attempts means no retake is offered", async (t) => {
  stubResult(t, { quiz: buildQuiz(), attempts: [attempt(1), attempt(2), attempt(3)] });

  const { qualification } = await quizService.getQuizResult("student-1", "quiz-1");

  assert.strictEqual(qualification.canRetake, false);
  assert.strictEqual(qualification.attemptsRemaining, 0);
});

// ---------------------------------------------------------------------------
// Question-level analysis
// ---------------------------------------------------------------------------

test("weak concepts count skips and hints, not just wrong answers", () => {
  const weak = summarizeWeakConcepts([
    // Right, but only after asking for a hint — not demonstrated.
    { answered: true, isCorrect: true, skipped: false, hintViewed: true, question: { topic: "Inheritance" } },
    // Skipped past entirely.
    { answered: false, isCorrect: null, skipped: true, hintViewed: false, question: { topic: "Scope" } },
    // Plainly wrong.
    { answered: true, isCorrect: false, skipped: false, hintViewed: false, question: { topic: "Data Types" } },
    // Clean pass — must not appear.
    { answered: true, isCorrect: true, skipped: false, hintViewed: false, question: { topic: "Variables" } }
  ]);

  const names = weak.map((w) => w.concept);
  assert.ok(names.includes("Inheritance"), "a hint-assisted answer is still an area to review");
  assert.ok(names.includes("Scope"));
  assert.ok(names.includes("Data Types"));
  assert.ok(!names.includes("Variables"), "a concept answered cleanly is not a weak area");

  const inheritance = weak.find((w) => w.concept === "Inheritance");
  assert.strictEqual(inheritance.hintsUsed, 1);
  assert.strictEqual(inheritance.missed, 0, "`missed` stays 'did not get this right'");

  const scope = weak.find((w) => w.concept === "Scope");
  assert.strictEqual(scope.skipped, 1);
  assert.strictEqual(scope.unanswered, 1);
});

test("genuinely missed concepts sort above hint-assisted ones", () => {
  const weak = summarizeWeakConcepts([
    { answered: true, isCorrect: true, skipped: false, hintViewed: true, question: { topic: "Hinted" } },
    { answered: true, isCorrect: false, skipped: false, hintViewed: false, question: { topic: "Wrong" } },
    { answered: true, isCorrect: false, skipped: false, hintViewed: false, question: { topic: "Wrong" } }
  ]);

  assert.strictEqual(weak[0].concept, "Wrong", "what they got wrong comes first");
});

test("buildQualificationOutcome — no context still produces a usable result", async (t) => {
  // Stubbed, not left to hit the database: resolveTargetTitle looks the
  // lesson up, and an unstubbed call here makes this test depend on live data
  // and on whatever else is running alongside it.
  const original = prisma.lesson.findUnique;
  t.after(() => {
    prisma.lesson.findUnique = original;
  });
  prisma.lesson.findUnique = async () => ({ title: "Logic Gates" });

  // The learn page's inline path calls this without allowance/history.
  const outcome = await buildQualificationOutcome(
    { quizTag: "QUALIFYING", lessonId: "lesson-1", passingScore: 70, attempts: 1 },
    { id: "a1", attemptNumber: 1, passed: true, percentage: 90, score: 9, totalMarks: 10, questionAttempts: [] }
  );

  assert.strictEqual(outcome.qualified, true);
  assert.strictEqual(outcome.attemptNumber, 1);
  assert.deepStrictEqual(outcome.questionBreakdown, {
    total: 0,
    correct: 0,
    incorrect: 0,
    skipped: 0,
    unanswered: 0
  });
  assert.strictEqual(outcome.hintsUsed, 0);
  assert.deepStrictEqual(outcome.attempts, []);
});
