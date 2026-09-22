const test = require("node:test");
const assert = require("node:assert");

const prisma = require("../src/config/database");
const analytics = require("../src/modules/results/quizAnalytics.service");

// The invariants under test, for instructor quiz analytics:
//
//  1. Every figure is DERIVED from the existing QuizAttempt / QuestionAttempt
//     records. Nothing is stored for analytics and nothing is re-graded.
//  2. "Incorrect" and "skipped" never merge. Choosing to move past a question
//     is a different signal from getting it wrong, and an instructor needs to
//     tell them apart.
//  3. Authorization is enforced in the QUERY, not by filtering afterwards: an
//     instructor cannot reach another instructor's quiz, and an admin is not
//     scoped by ownership.
//  4. A quiz with no attempts, or no questions, reports zeroes rather than
//     failing.

const QUIZ_ID = "quiz-1";

const buildQuiz = (overrides = {}) => ({
  id: QUIZ_ID,
  title: "Java Basics",
  quizTag: "FINAL",
  passingScore: 70,
  attempts: 3,
  timeLimit: null,
  lessonId: null,
  topicId: null,
  course: { id: "course-1", title: "Java" },
  quizQuestions: [
    {
      order: 1,
      marks: 1,
      question: {
        id: "q1",
        question: "What is inheritance in Java?",
        questionType: "MCQ_SINGLE",
        topic: "Inheritance",
        options: ["A", "B", "C", "D"],
        correctAnswer: "B"
      }
    },
    {
      order: 2,
      marks: 1,
      question: {
        id: "q2",
        question: "Which keyword extends a class?",
        questionType: "MCQ_SINGLE",
        topic: "Inheritance",
        options: ["extends", "implements"],
        correctAnswer: "extends"
      }
    }
  ],
  ...overrides
});

const attemptRow = (id, studentId, attemptNumber, percentage, passed, timeTakenSeconds = 120) => ({
  id,
  studentId,
  attemptNumber,
  percentage,
  passed,
  timeTakenSeconds
});

/**
 * Stubs every read getQuizAnalytics makes. `counts` is keyed by the groupBy
 * filter the service uses, so a test declares the shape of the data rather
 * than the order of the queries.
 */
function stubAnalytics(t, { quiz, attempts = [], counts = {}, times = [], options = [] }) {
  const originals = {
    quizFindFirst: prisma.quiz.findFirst,
    attemptFindMany: prisma.quizAttempt.findMany,
    questionGroupBy: prisma.questionAttempt.groupBy,
    queryRaw: prisma.$queryRaw,
    lessonFindUnique: prisma.lesson.findUnique,
    topicFindUnique: prisma.topic.findUnique
  };

  t.after(() => {
    prisma.quiz.findFirst = originals.quizFindFirst;
    prisma.quizAttempt.findMany = originals.attemptFindMany;
    prisma.questionAttempt.groupBy = originals.questionGroupBy;
    prisma.$queryRaw = originals.queryRaw;
    prisma.lesson.findUnique = originals.lessonFindUnique;
    prisma.topic.findUnique = originals.topicFindUnique;
  });

  const captured = { quizWhere: null, groupByWheres: [] };

  prisma.quiz.findFirst = async ({ where }) => {
    captured.quizWhere = where;
    return quiz;
  };
  prisma.quizAttempt.findMany = async () => attempts;
  prisma.lesson.findUnique = async () => ({ id: "lesson-1", title: "Java Basics" });
  prisma.topic.findUnique = async () => ({ id: "topic-1", title: "Inheritance" });

  prisma.questionAttempt.groupBy = async ({ where }) => {
    captured.groupByWheres.push(where);
    const toRows = (map) =>
      Object.entries(map || {}).map(([questionId, n]) => ({
        questionId,
        _count: { _all: n }
      }));

    if (where.isCorrect === true) return toRows(counts.correct);
    if (where.answered === true && where.isCorrect === false) return toRows(counts.incorrect);
    if (where.answered === true) return toRows(counts.answered);
    if (where.skipped === true) return toRows(counts.skipped);
    if (where.hintViewed === true) return toRows(counts.hinted);
    return toRows(counts.responses);
  };

  // Two raw queries: per-question average time, then option distribution.
  let rawCall = 0;
  prisma.$queryRaw = async () => (rawCall++ === 0 ? times : options);

  return captured;
}

const questionById = (result, id) => result.questions.find((q) => q.questionId === id);
const instructor = { id: "instructor-1", role: "INSTRUCTOR" };

// ---------------------------------------------------------------------------
// Authorization
// ---------------------------------------------------------------------------

test("buildQuizScope — an instructor is scoped to courses they created", () => {
  const scope = analytics.buildQuizScope(instructor, { quizId: QUIZ_ID });
  assert.deepStrictEqual(scope, {
    id: QUIZ_ID,
    course: { creatorId: "instructor-1" }
  });
});

test("buildQuizScope — an admin is not scoped by ownership", () => {
  const scope = analytics.buildQuizScope({ id: "admin-1", role: "ADMIN" }, { quizId: QUIZ_ID });
  assert.deepStrictEqual(scope, { id: QUIZ_ID }, "admins see every course, as everywhere else in the LMS");
});

test("buildQuizScope — an unknown caller matches nothing rather than everything", () => {
  const scope = analytics.buildQuizScope(undefined, { quizId: QUIZ_ID });
  assert.strictEqual(scope.course.creatorId, "__none__", "a missing id must never widen the scope");
});

test("another instructor's quiz is reported as not found", async (t) => {
  // The scope is part of the query, so the row simply doesn't come back.
  const captured = stubAnalytics(t, { quiz: null });

  const result = await analytics.getQuizAnalytics(instructor, { quizId: QUIZ_ID });

  assert.strictEqual(result, null, "not found and not allowed answer the same way");
  assert.deepStrictEqual(captured.quizWhere.course, { creatorId: "instructor-1" });
});

test("a missing quizId is rejected before any query runs", async () => {
  await assert.rejects(
    () => analytics.getQuizAnalytics(instructor, {}),
    (error) => error.statusCode === 400
  );
});

// ---------------------------------------------------------------------------
// Quiz-level analytics
// ---------------------------------------------------------------------------

test("quiz-level analytics are folded from the attempt log", async (t) => {
  stubAnalytics(t, {
    quiz: buildQuiz(),
    // Two students: one attempted twice (failed then passed), one passed once.
    attempts: [
      attemptRow("a1", "s1", 1, 40, false, 100),
      attemptRow("a2", "s1", 2, 80, true, 200),
      attemptRow("a3", "s2", 1, 90, true, 60)
    ],
    counts: {
      responses: { q1: 3, q2: 3 },
      answered: { q1: 3, q2: 2 },
      correct: { q1: 2, q2: 1 },
      incorrect: { q1: 1, q2: 1 },
      skipped: { q2: 1 },
      hinted: { q1: 1 }
    }
  });

  const { summary } = await analytics.getQuizAnalytics(instructor, { quizId: QUIZ_ID });

  assert.strictEqual(summary.totalAttempts, 3, "every attempt counts, not just the latest per student");
  assert.strictEqual(summary.uniqueStudents, 2);
  assert.strictEqual(summary.averageScore, 70);
  assert.strictEqual(summary.highestScore, 90);
  assert.strictEqual(summary.lowestScore, 40);
  assert.strictEqual(summary.passCount, 2);
  assert.strictEqual(summary.failCount, 1);
  assert.strictEqual(summary.passRate, 66.7);
  assert.strictEqual(summary.failRate, 33.3);
  assert.strictEqual(summary.averageCompletionSeconds, 120);
  assert.strictEqual(summary.totalQuestions, 2);
  // 5 answered across 3 attempts.
  assert.strictEqual(summary.averageAttemptedQuestions, 1.7);
  assert.strictEqual(summary.averageSkippedQuestions, 0.3);
  assert.strictEqual(summary.totalHintsUsed, 1);
});

test("unmeasured completion time reports null, not zero", async (t) => {
  stubAnalytics(t, {
    quiz: buildQuiz(),
    attempts: [attemptRow("a1", "s1", 1, 50, false, null)],
    counts: { responses: { q1: 1, q2: 1 } }
  });

  const { summary } = await analytics.getQuizAnalytics(instructor, { quizId: QUIZ_ID });
  assert.strictEqual(summary.averageCompletionSeconds, null, "'not measured' is not 'instant'");
});

test("a quiz nobody has attempted reports zeroes rather than failing", async (t) => {
  stubAnalytics(t, { quiz: buildQuiz(), attempts: [] });

  const result = await analytics.getQuizAnalytics(instructor, { quizId: QUIZ_ID });

  assert.strictEqual(result.summary.totalAttempts, 0);
  assert.strictEqual(result.summary.uniqueStudents, 0);
  assert.strictEqual(result.summary.averageScore, 0);
  assert.strictEqual(result.summary.passRate, 0);
  assert.strictEqual(result.questions.length, 2, "its questions are still listed");
  assert.strictEqual(result.questions[0].responses, 0);
  assert.deepStrictEqual(result.difficultQuestions, [], "nothing is 'difficult' without evidence");
});

test("a quiz with no questions is a legitimate, empty result", async (t) => {
  stubAnalytics(t, { quiz: buildQuiz({ quizQuestions: [] }), attempts: [] });

  const result = await analytics.getQuizAnalytics(instructor, { quizId: QUIZ_ID });

  assert.strictEqual(result.summary.totalQuestions, 0);
  assert.deepStrictEqual(result.questions, []);
  assert.deepStrictEqual(result.weakAreas, []);
});

// ---------------------------------------------------------------------------
// Question-level analytics
// ---------------------------------------------------------------------------

test("question-level analytics keep incorrect and skipped apart", async (t) => {
  stubAnalytics(t, {
    quiz: buildQuiz(),
    attempts: [attemptRow("a1", "s1", 1, 50, false)],
    counts: {
      // 84 responses: 51 correct, 25 incorrect, 8 skipped.
      responses: { q1: 84 },
      answered: { q1: 76 },
      correct: { q1: 51 },
      incorrect: { q1: 25 },
      skipped: { q1: 8 },
      hinted: { q1: 19 }
    },
    times: [{ questionId: "q1", avgSeconds: 42.4 }]
  });

  const q1 = questionById(await analytics.getQuizAnalytics(instructor, { quizId: QUIZ_ID }), "q1");

  assert.strictEqual(q1.responses, 84);
  assert.strictEqual(q1.correct, 51);
  assert.strictEqual(q1.incorrect, 25);
  assert.strictEqual(q1.skipped, 8);
  assert.strictEqual(q1.hintsUsed, 19);
  assert.strictEqual(q1.correctRate, 60.7);
  assert.strictEqual(q1.incorrectRate, 29.8);
  assert.strictEqual(q1.skipRate, 9.5);
  assert.strictEqual(q1.averageSeconds, 42);

  // The distinction the spec insists on: these are separate fields that are
  // never summed into one another.
  assert.notStrictEqual(q1.incorrect, q1.incorrect + q1.skipped);
  assert.strictEqual(q1.unanswered, 8, "responses minus answered");
});

test("a question never reached is counted, not dropped", async (t) => {
  // The old analytics ignored any question left blank, so a question nobody
  // reached looked like it had never been asked.
  stubAnalytics(t, {
    quiz: buildQuiz(),
    attempts: [attemptRow("a1", "s1", 1, 0, false)],
    counts: { responses: { q1: 10, q2: 10 }, answered: { q1: 10 }, correct: { q1: 10 } }
  });

  const q2 = questionById(await analytics.getQuizAnalytics(instructor, { quizId: QUIZ_ID }), "q2");

  assert.strictEqual(q2.responses, 10);
  assert.strictEqual(q2.answered, 0);
  assert.strictEqual(q2.unanswered, 10);
  assert.strictEqual(q2.correctRate, 0);
});

test("difficult questions lead with the worst, and expose why", async (t) => {
  stubAnalytics(t, {
    quiz: buildQuiz(),
    attempts: [attemptRow("a1", "s1", 1, 50, false)],
    counts: {
      responses: { q1: 10, q2: 10 },
      answered: { q1: 10, q2: 4 },
      correct: { q1: 9, q2: 1 },
      incorrect: { q1: 1, q2: 3 },
      skipped: { q2: 6 },
      hinted: { q2: 5 }
    }
  });

  const { difficultQuestions } = await analytics.getQuizAnalytics(instructor, { quizId: QUIZ_ID });

  assert.strictEqual(difficultQuestions[0].questionId, "q2", "the weakest question leads");
  // No blended score — the raw signals are there so the instructor can see why.
  assert.strictEqual(difficultQuestions[0].correctRate, 10);
  assert.strictEqual(difficultQuestions[0].skipRate, 60);
  assert.strictEqual(difficultQuestions[0].hintRate, 50);
  assert.ok(!("difficultyScore" in difficultQuestions[0]), "no invented single difficulty number");
});

test("option distribution reports how often each choice was taken", async (t) => {
  stubAnalytics(t, {
    quiz: buildQuiz(),
    attempts: [attemptRow("a1", "s1", 1, 50, false)],
    counts: { responses: { q1: 100 }, answered: { q1: 100 } },
    options: [
      { questionId: "q1", answer: '"A"', count: 8 },
      { questionId: "q1", answer: '"B"', count: 67 },
      { questionId: "q1", answer: '"C"', count: 15 },
      { questionId: "q1", answer: '"D"', count: 10 }
    ]
  });

  const q1 = questionById(await analytics.getQuizAnalytics(instructor, { quizId: QUIZ_ID }), "q1");

  assert.deepStrictEqual(
    q1.optionDistribution.map((o) => `${o.option}:${o.percentage}`),
    ["B:67", "C:15", "D:10", "A:8"],
    "most-chosen first, so a popular wrong answer stands out"
  );
  // The instructor authors the question, so the key is theirs to see.
  assert.strictEqual(q1.correctAnswer, "B");
});

test("weak areas roll questions up by concept, weakest first", async (t) => {
  stubAnalytics(t, {
    quiz: buildQuiz({
      quizQuestions: [
        { order: 1, marks: 1, question: { id: "q1", question: "A", questionType: "MCQ_SINGLE", topic: "Inheritance", options: [], correctAnswer: "x" } },
        { order: 2, marks: 1, question: { id: "q2", question: "B", questionType: "MCQ_SINGLE", topic: "Generics", options: [], correctAnswer: "x" } },
        // "General" is a placeholder, not a taught concept.
        { order: 3, marks: 1, question: { id: "q3", question: "C", questionType: "MCQ_SINGLE", topic: "General", options: [], correctAnswer: "x" } }
      ]
    }),
    attempts: [attemptRow("a1", "s1", 1, 50, false)],
    counts: {
      responses: { q1: 10, q2: 10, q3: 10 },
      answered: { q1: 10, q2: 10, q3: 10 },
      correct: { q1: 9, q2: 2, q3: 5 }
    }
  });

  const { weakAreas } = await analytics.getQuizAnalytics(instructor, { quizId: QUIZ_ID });

  assert.deepStrictEqual(
    weakAreas.map((w) => w.concept),
    ["Generics", "Inheritance"],
    "weakest concept first; a placeholder topic is not a concept"
  );
  assert.strictEqual(weakAreas[0].correctRate, 20);
});

// ---------------------------------------------------------------------------
// Qualifying-test analytics
// ---------------------------------------------------------------------------

test("a qualifying test reports its target and how hard it is to qualify", async (t) => {
  stubAnalytics(t, {
    quiz: buildQuiz({ quizTag: "QUALIFYING", lessonId: "lesson-1" }),
    attempts: [
      // s1 failed then qualified on attempt 2.
      attemptRow("a1", "s1", 1, 40, false),
      attemptRow("a2", "s1", 2, 90, true),
      // s2 qualified first time.
      attemptRow("a3", "s2", 1, 95, true),
      // s3 is still failing.
      attemptRow("a4", "s3", 1, 30, false),
      attemptRow("a5", "s3", 2, 35, false)
    ],
    counts: { responses: { q1: 5, q2: 5 }, answered: { q1: 5, q2: 5 }, correct: { q1: 3, q2: 2 } }
  });

  const { qualifying } = await analytics.getQuizAnalytics(instructor, { quizId: QUIZ_ID });

  assert.strictEqual(qualifying.target.kind, "LESSON");
  assert.strictEqual(qualifying.target.title, "Java Basics");
  assert.strictEqual(qualifying.studentsAttempted, 3);
  assert.strictEqual(qualifying.qualifiedStudents, 2);
  assert.strictEqual(qualifying.notQualifiedStudents, 1);
  assert.strictEqual(qualifying.qualificationRate, 66.7);
  // s1 qualified on attempt 2, s2 on attempt 1 — averaged over those who
  // actually qualified, not over everyone still trying.
  assert.strictEqual(qualifying.averageAttemptsToQualify, 1.5);
});

test("an ordinary quiz carries no qualifying block", async (t) => {
  for (const quizTag of ["FINAL", "SELF_TEST"]) {
    const originals = {
      quizFindFirst: prisma.quiz.findFirst,
      attemptFindMany: prisma.quizAttempt.findMany,
      questionGroupBy: prisma.questionAttempt.groupBy,
      queryRaw: prisma.$queryRaw
    };
    prisma.quiz.findFirst = async () => buildQuiz({ quizTag });
    prisma.quizAttempt.findMany = async () => [attemptRow("a1", "s1", 1, 80, true)];
    prisma.questionAttempt.groupBy = async () => [];
    prisma.$queryRaw = async () => [];

    const result = await analytics.getQuizAnalytics(instructor, { quizId: QUIZ_ID });
    assert.strictEqual(result.qualifying, null, `${quizTag} is not a qualifying test`);

    prisma.quiz.findFirst = originals.quizFindFirst;
    prisma.quizAttempt.findMany = originals.attemptFindMany;
    prisma.questionAttempt.groupBy = originals.questionGroupBy;
    prisma.$queryRaw = originals.queryRaw;
  }
});

test("a qualifying test nobody has qualified for reports null, not zero attempts", async (t) => {
  stubAnalytics(t, {
    quiz: buildQuiz({ quizTag: "QUALIFYING", lessonId: "lesson-1" }),
    attempts: [attemptRow("a1", "s1", 1, 30, false)],
    counts: { responses: { q1: 1, q2: 1 } }
  });

  const { qualifying } = await analytics.getQuizAnalytics(instructor, { quizId: QUIZ_ID });

  assert.strictEqual(qualifying.qualifiedStudents, 0);
  assert.strictEqual(qualifying.qualificationRate, 0);
  assert.strictEqual(
    qualifying.averageAttemptsToQualify,
    null,
    "there is no average over an empty set"
  );
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

test("rate — one decimal, and safe on an empty denominator", () => {
  assert.strictEqual(analytics.rate(51, 84), 60.7);
  assert.strictEqual(analytics.rate(1, 3), 33.3);
  assert.strictEqual(analytics.rate(0, 0), 0, "no division by zero");
  assert.strictEqual(analytics.rate(5, 5), 100);
});
