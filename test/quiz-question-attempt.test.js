const test = require("node:test");
const assert = require("node:assert");

const prisma = require("../src/config/database");
const quizService = require("../src/modules/quizzes/quiz.service");
const { submitQuizSchema } = require("../src/modules/quizzes/quiz.validation");

// The invariants under test, for question-level attempt tracking:
//
//  1. One QuestionAttempt record per question per attempt — changing an
//     answer, skipping then answering, or revisiting a question updates that
//     one record and never produces a second.
//  2. Every figure an attempt reports (answered / unanswered / skipped /
//     visited / correct / marks) is FOLDED from those records, not kept as an
//     independently-maintained counter that could drift.
//  3. Correctness and marks are decided server-side. A client can report
//     where it navigated; it cannot report what it scored.
//  4. A submitted attempt is immutable: a retake writes its own records under
//     its own QuizAttempt and leaves the previous attempt untouched.

const buildQuiz = (overrides = {}) => ({
  id: "quiz-1",
  courseId: "course-1",
  title: "Tracking Quiz",
  passingScore: 50,
  attempts: 0,
  quizTag: "FINAL",
  quizQuestions: [
    {
      order: 1,
      marks: 2,
      question: {
        id: "q1",
        question: "2 + 2?",
        questionType: "MCQ_SINGLE",
        options: ["4", "5"],
        correctAnswer: "4",
        topic: "arithmetic",
        marks: 2,
        negativeMarks: 0
      }
    },
    {
      order: 2,
      marks: 1,
      question: {
        id: "q2",
        question: "Capital of France?",
        questionType: "MCQ_SINGLE",
        options: ["Paris", "Rome"],
        correctAnswer: "Paris",
        topic: "geography",
        marks: 1,
        negativeMarks: 0
      }
    },
    {
      order: 3,
      marks: 1,
      question: {
        id: "q3",
        question: "Largest ocean?",
        questionType: "MCQ_SINGLE",
        options: ["Pacific", "Atlantic"],
        correctAnswer: "Pacific",
        topic: "geography",
        marks: 1,
        negativeMarks: 0
      }
    }
  ],
  ...overrides
});

const rowsFor = (quiz, answers, questionStates) =>
  quizService.buildQuestionAttemptRows(
    quizService.calculateSubmissionResult(quiz, answers),
    questionStates
  );

const byId = (rows) => new Map(rows.map((row) => [row.questionId, row]));

// ---------------------------------------------------------------------------
// Status model
// ---------------------------------------------------------------------------

test("resolveQuestionStatus — answering outranks skipping, skipping outranks visiting", () => {
  const { resolveQuestionStatus } = quizService;

  assert.strictEqual(
    resolveQuestionStatus({ answered: false, skipped: false, visited: false }),
    "NOT_VISITED"
  );
  assert.strictEqual(
    resolveQuestionStatus({ answered: false, skipped: false, visited: true }),
    "VISITED"
  );
  assert.strictEqual(
    resolveQuestionStatus({ answered: false, skipped: true, visited: true }),
    "SKIPPED"
  );
  // The skip-then-answer case: the record ends ANSWERED.
  assert.strictEqual(
    resolveQuestionStatus({ answered: true, skipped: true, visited: true }),
    "ANSWERED"
  );
});

// ---------------------------------------------------------------------------
// Record building
// ---------------------------------------------------------------------------

test("buildQuestionAttemptRows — one record per question, whatever the student did", () => {
  const quiz = buildQuiz();

  const rows = rowsFor(
    quiz,
    [{ questionId: "q1", answer: "4" }],
    [
      // The same question visited repeatedly and answered twice over — the
      // shape the attempt UI produces when a student changes their mind.
      { questionId: "q1", visited: true, status: "ANSWERED" },
      { questionId: "q1", visited: true, status: "ANSWERED" },
      { questionId: "q2", visited: true, skipped: true, status: "SKIPPED" }
    ]
  );

  assert.strictEqual(rows.length, 3, "one record per question in the quiz");
  assert.deepStrictEqual(
    rows.map((r) => r.questionId).sort(),
    ["q1", "q2", "q3"],
    "no duplicate records, and none missing"
  );
});

test("buildQuestionAttemptRows — a skipped question that is later answered ends ANSWERED", () => {
  const quiz = buildQuiz();

  const rows = byId(
    rowsFor(
      quiz,
      [{ questionId: "q2", answer: "Paris" }],
      [{ questionId: "q2", visited: true, skipped: true, status: "SKIPPED" }]
    )
  );

  const q2 = rows.get("q2");
  assert.strictEqual(q2.status, "ANSWERED");
  assert.strictEqual(q2.answered, true);
  // The skip still happened — status says where it ended, `skipped` says what
  // it went through.
  assert.strictEqual(q2.skipped, true, "the skip stays on the record as history");
  assert.strictEqual(q2.isCorrect, true);
});

test("buildQuestionAttemptRows — an unanswered question is not 'incorrect'", () => {
  const quiz = buildQuiz();

  const rows = byId(rowsFor(quiz, [], [{ questionId: "q3", visited: true }]));
  const q3 = rows.get("q3");

  assert.strictEqual(q3.status, "VISITED");
  assert.strictEqual(q3.answered, false);
  assert.strictEqual(q3.answer, null);
  assert.strictEqual(q3.isCorrect, null, "never answered is not the same fact as wrong");
  assert.strictEqual(q3.marksObtained, 0);
});

test("buildQuestionAttemptRows — a question nobody opened is NOT_VISITED", () => {
  const rows = byId(rowsFor(buildQuiz(), [], []));

  for (const id of ["q1", "q2", "q3"]) {
    assert.strictEqual(rows.get(id).status, "NOT_VISITED");
    assert.strictEqual(rows.get(id).visited, false);
  }
});

test("buildQuestionAttemptRows — an answered question counts as visited even if the client never said so", () => {
  const rows = byId(rowsFor(buildQuiz(), [{ questionId: "q1", answer: "4" }], []));

  assert.strictEqual(rows.get("q1").visited, true);
  assert.strictEqual(rows.get("q1").status, "ANSWERED");
});

test("buildQuestionAttemptRows — client-reported state for a foreign question is dropped", () => {
  const rows = rowsFor(buildQuiz(), [], [
    { questionId: "not-in-this-quiz", visited: true, status: "ANSWERED" }
  ]);

  assert.strictEqual(rows.length, 3);
  assert.ok(
    !rows.some((r) => r.questionId === "not-in-this-quiz"),
    "the quiz's question set decides which records exist, not the payload"
  );
});

test("buildQuestionAttemptRows — grading comes from the server, not the payload", () => {
  // The client claims everything was answered and correct; it answered one
  // question, wrongly.
  const rows = byId(
    rowsFor(
      buildQuiz(),
      [{ questionId: "q1", answer: "5" }],
      [
        { questionId: "q1", status: "ANSWERED", visited: true },
        { questionId: "q2", status: "ANSWERED", visited: true },
        { questionId: "q3", status: "ANSWERED", visited: true }
      ]
    )
  );

  assert.strictEqual(rows.get("q1").isCorrect, false, "a wrong answer stays wrong");
  assert.strictEqual(rows.get("q1").marksObtained, 0);
  assert.strictEqual(rows.get("q2").answered, false, "a claimed answer that isn't there isn't one");
  assert.strictEqual(rows.get("q2").status, "VISITED");
  assert.strictEqual(rows.get("q3").answered, false);
});

test("buildQuestionAttemptRows — marks come from the quiz's per-question override", () => {
  const rows = byId(
    rowsFor(buildQuiz(), [
      { questionId: "q1", answer: "4" },
      { questionId: "q2", answer: "Paris" }
    ])
  );

  assert.strictEqual(rows.get("q1").maxMarks, 2);
  assert.strictEqual(rows.get("q1").marksObtained, 2);
  assert.strictEqual(rows.get("q2").maxMarks, 1);
  assert.strictEqual(rows.get("q2").marksObtained, 1);
  assert.strictEqual(rows.get("q3").maxMarks, 1);
  assert.strictEqual(rows.get("q3").marksObtained, 0);
});

test("buildQuestionAttemptRows — a garbage timestamp becomes null, never an Invalid Date", () => {
  const rows = byId(
    rowsFor(buildQuiz(), [], [{ questionId: "q1", visited: true, firstVisitedAt: "not-a-date" }])
  );

  assert.strictEqual(rows.get("q1").firstVisitedAt, null);
  assert.strictEqual(rows.get("q1").visited, true);
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

test("summarizeQuestionAttempts — every tally is folded from the records", () => {
  const quiz = buildQuiz();

  // q1 answered correctly, q2 skipped then answered wrongly, q3 never opened.
  const rows = rowsFor(
    quiz,
    [
      { questionId: "q1", answer: "4" },
      { questionId: "q2", answer: "Rome" }
    ],
    [
      { questionId: "q1", visited: true },
      { questionId: "q2", visited: true, skipped: true }
    ]
  );

  const summary = quizService.summarizeQuestionAttempts(rows);

  assert.strictEqual(summary.totalQuestions, 3);
  assert.strictEqual(summary.answeredCount, 2);
  assert.strictEqual(summary.unansweredCount, 1);
  assert.strictEqual(summary.skippedCount, 1);
  assert.strictEqual(summary.visitedCount, 2);
  assert.strictEqual(summary.notVisitedCount, 1);
  assert.strictEqual(summary.correctCount, 1);
  assert.strictEqual(summary.incorrectCount, 1);
  assert.strictEqual(summary.marksObtained, 2);
  assert.strictEqual(summary.maxMarks, 4);
  assert.strictEqual(summary.score, 2);
  assert.strictEqual(summary.percentage, 50);
});

test("summarizeQuestionAttempts — its score matches what the attempt is graded at", () => {
  const quiz = buildQuiz();
  const answers = [
    { questionId: "q1", answer: "4" },
    { questionId: "q3", answer: "Pacific" }
  ];

  const result = quizService.calculateSubmissionResult(quiz, answers);
  const summary = quizService.summarizeQuestionAttempts(
    quizService.buildQuestionAttemptRows(result, [])
  );

  assert.strictEqual(summary.score, result.score);
  assert.strictEqual(summary.maxMarks, result.totalMarks);
  assert.strictEqual(summary.percentage, result.percentage);
});

test("summarizeQuestionAttempts — negative marking never drives the score below zero", () => {
  const quiz = buildQuiz();
  quiz.quizQuestions[0].question.negativeMarks = 5;

  const rows = quizService.buildQuestionAttemptRows(
    quizService.calculateSubmissionResult(quiz, [{ questionId: "q1", answer: "5" }]),
    []
  );
  const summary = quizService.summarizeQuestionAttempts(rows);

  assert.strictEqual(summary.marksObtained, -5, "the record keeps the real penalty");
  assert.strictEqual(summary.score, 0, "the attempt is still not scored below zero");
});

// ---------------------------------------------------------------------------
// Submission
// ---------------------------------------------------------------------------

/** Stubs prisma so submitQuiz runs against captured in-memory writes. */
function stubSubmission(t, { quiz, attempts = [] }) {
  const originals = {
    quizFindUnique: prisma.quiz.findUnique,
    transaction: prisma.$transaction,
    quizProgressFindUnique: prisma.quizProgress.findUnique,
    quizProgressUpsert: prisma.quizProgress.upsert,
    courseFindUnique: prisma.course.findUnique,
    studentProfileFindUnique: prisma.studentProfile.findUnique
  };

  t.after(() => {
    prisma.quiz.findUnique = originals.quizFindUnique;
    prisma.$transaction = originals.transaction;
    prisma.quizProgress.findUnique = originals.quizProgressFindUnique;
    prisma.quizProgress.upsert = originals.quizProgressUpsert;
    prisma.course.findUnique = originals.courseFindUnique;
    prisma.studentProfile.findUnique = originals.studentProfileFindUnique;
  });

  const written = { attempts, questionAttempts: [] };

  prisma.quiz.findUnique = async () => quiz;
  prisma.quizProgress.findUnique = async () => null;
  prisma.quizProgress.upsert = async () => ({});
  prisma.course.findUnique = async () => ({ id: quiz.courseId, instructorId: null });
  prisma.studentProfile.findUnique = async () => null;

  prisma.$transaction = async (fn) => {
    const tx = {
      quizAttempt: {
        findFirst: async () =>
          written.attempts.length > 0
            ? written.attempts[written.attempts.length - 1]
            : null,
        create: async ({ data }) => {
          const created = {
            id: `attempt-${written.attempts.length + 1}`,
            submittedAt: new Date(),
            ...data
          };
          written.attempts.push(created);
          return created;
        }
      },
      questionAttempt: {
        createMany: async ({ data }) => {
          written.questionAttempts.push(...data);
          return { count: data.length };
        }
      },
      quizSubmission: {
        findUnique: async () => null,
        upsert: async ({ create }) => ({ id: "submission-1", ...create })
      }
    };
    return fn(tx);
  };

  return written;
}

test("submitQuiz — writes one question record per question, under this attempt", async (t) => {
  const quiz = buildQuiz();
  const written = stubSubmission(t, { quiz });

  await quizService.submitQuiz(
    "student-1",
    quiz.id,
    [{ questionId: "q1", answer: "4" }],
    42,
    [
      { questionId: "q1", visited: true, status: "ANSWERED" },
      { questionId: "q2", visited: true, skipped: true, status: "SKIPPED" }
    ]
  );
  await quizService.flushPendingSubmissionSideEffects();

  assert.strictEqual(written.questionAttempts.length, 3);
  assert.ok(
    written.questionAttempts.every((row) => row.quizAttemptId === "attempt-1"),
    "every record hangs off the attempt just created"
  );

  const rows = byId(written.questionAttempts);
  assert.strictEqual(rows.get("q1").status, "ANSWERED");
  assert.strictEqual(rows.get("q2").status, "SKIPPED");
  assert.strictEqual(rows.get("q3").status, "NOT_VISITED");
  assert.strictEqual(rows.get("q1").order, 1, "the question's position is captured with it");
});

test("submitQuiz — the attempt's counters agree with its question records", async (t) => {
  const quiz = buildQuiz();
  const written = stubSubmission(t, { quiz });

  await quizService.submitQuiz(
    "student-1",
    quiz.id,
    [
      { questionId: "q1", answer: "4" },
      { questionId: "q2", answer: "Rome" }
    ],
    null,
    [{ questionId: "q3", visited: true, skipped: true }]
  );
  await quizService.flushPendingSubmissionSideEffects();

  const attempt = written.attempts[0];
  const summary = quizService.summarizeQuestionAttempts(written.questionAttempts);

  assert.strictEqual(attempt.correctCount, summary.correctCount);
  assert.strictEqual(attempt.incorrectCount, summary.incorrectCount);
  assert.strictEqual(attempt.unansweredCount, summary.unansweredCount);
  assert.strictEqual(attempt.correctCount, 1);
  assert.strictEqual(attempt.incorrectCount, 1);
  assert.strictEqual(attempt.unansweredCount, 1);
});

test("submitQuiz — submitting with everything unanswered still records every question", async (t) => {
  const quiz = buildQuiz();
  const written = stubSubmission(t, { quiz });

  await quizService.submitQuiz("student-1", quiz.id, [], null, []);
  await quizService.flushPendingSubmissionSideEffects();

  assert.strictEqual(written.questionAttempts.length, 3);
  assert.strictEqual(written.attempts[0].unansweredCount, 3);
  assert.strictEqual(written.attempts[0].score, 0);
  assert.ok(
    written.questionAttempts.every((row) => row.isCorrect === null),
    "nothing answered means nothing to be right or wrong about"
  );
});

test("submitQuiz — a second attempt leaves the first attempt's records untouched", async (t) => {
  const quiz = buildQuiz();
  const written = stubSubmission(t, { quiz });

  await quizService.submitQuiz("student-1", quiz.id, [{ questionId: "q1", answer: "5" }], null, [
    { questionId: "q1", visited: true }
  ]);
  await quizService.flushPendingSubmissionSideEffects();

  const firstAttemptRows = written.questionAttempts
    .filter((row) => row.quizAttemptId === "attempt-1")
    .map((row) => ({ ...row }));

  await quizService.submitQuiz(
    "student-1",
    quiz.id,
    [
      { questionId: "q1", answer: "4" },
      { questionId: "q2", answer: "Paris" },
      { questionId: "q3", answer: "Pacific" }
    ],
    null,
    []
  );
  await quizService.flushPendingSubmissionSideEffects();

  assert.strictEqual(written.attempts.length, 2);
  assert.strictEqual(written.attempts[0].attemptNumber, 1);
  assert.strictEqual(written.attempts[1].attemptNumber, 2);

  // Attempt 1's records are exactly as they were written.
  const firstNow = written.questionAttempts.filter((row) => row.quizAttemptId === "attempt-1");
  assert.deepStrictEqual(firstNow, firstAttemptRows);
  assert.strictEqual(written.attempts[0].score, 0, "the failed first attempt keeps its score");

  // Attempt 2 has its own, separate set.
  const secondRows = byId(
    written.questionAttempts.filter((row) => row.quizAttemptId === "attempt-2")
  );
  assert.strictEqual(secondRows.size, 3);
  assert.strictEqual(secondRows.get("q1").isCorrect, true);
  assert.strictEqual(written.attempts[1].score, 4);
});

test("submitQuiz — a client that sends no questionStates still gets full records", async (t) => {
  const quiz = buildQuiz();
  const written = stubSubmission(t, { quiz });

  // The pre-tracking payload shape: answers only.
  await quizService.submitQuiz("student-1", quiz.id, [{ questionId: "q1", answer: "4" }], null);
  await quizService.flushPendingSubmissionSideEffects();

  assert.strictEqual(written.questionAttempts.length, 3);
  assert.strictEqual(byId(written.questionAttempts).get("q1").status, "ANSWERED");
});

// ---------------------------------------------------------------------------
// Payload validation
// ---------------------------------------------------------------------------

test("submitQuizSchema — accepts question states, and still accepts a payload without them", () => {
  const withStates = submitQuizSchema.validate({
    answers: [{ questionId: "q1", answer: "4" }],
    questionStates: [
      {
        questionId: "q1",
        status: "ANSWERED",
        visited: true,
        skipped: false,
        hintViewed: false,
        firstVisitedAt: new Date().toISOString(),
        answeredAt: new Date().toISOString()
      }
    ],
    timeTakenSeconds: 30
  });
  assert.strictEqual(withStates.error, undefined);

  const withoutStates = submitQuizSchema.validate({
    answers: [{ questionId: "q1", answer: "4" }]
  });
  assert.strictEqual(withoutStates.error, undefined);
});

test("submitQuizSchema — rejects a status outside the tracked set", () => {
  const { error } = submitQuizSchema.validate({
    answers: [],
    questionStates: [{ questionId: "q1", status: "FLAGGED" }]
  });

  assert.ok(error, "an unknown status must not reach the database enum");
});

test("submitQuizSchema — a client cannot report its own marks or correctness", () => {
  const { error } = submitQuizSchema.validate({
    answers: [],
    questionStates: [{ questionId: "q1", status: "ANSWERED", isCorrect: true, marksObtained: 99 }]
  });

  assert.ok(error, "grading fields are the server's to decide and are refused here");
});

// ---------------------------------------------------------------------------
// Reading an attempt back
// ---------------------------------------------------------------------------

/** Stubs the three reads getQuizResult makes. */
function stubResult(t, { quiz, attempts, submission = null }) {
  const originals = {
    quizFindUnique: prisma.quiz.findUnique,
    attemptFindMany: prisma.quizAttempt.findMany,
    submissionFindUnique: prisma.quizSubmission.findUnique
  };

  t.after(() => {
    prisma.quiz.findUnique = originals.quizFindUnique;
    prisma.quizAttempt.findMany = originals.attemptFindMany;
    prisma.quizSubmission.findUnique = originals.submissionFindUnique;
  });

  prisma.quiz.findUnique = async () => quiz;
  prisma.quizAttempt.findMany = async () => attempts;
  prisma.quizSubmission.findUnique = async () => submission;
}

test("getQuizResult — returns the selected attempt's own records and a summary folded from them", async (t) => {
  const quiz = buildQuiz();

  const attemptOneRows = quizService.buildQuestionAttemptRows(
    quizService.calculateSubmissionResult(quiz, [{ questionId: "q1", answer: "5" }]),
    [{ questionId: "q1", visited: true, skipped: true }]
  );
  const attemptTwoRows = quizService.buildQuestionAttemptRows(
    quizService.calculateSubmissionResult(quiz, [
      { questionId: "q1", answer: "4" },
      { questionId: "q2", answer: "Paris" }
    ]),
    []
  );

  stubResult(t, {
    quiz,
    attempts: [
      {
        id: "attempt-1",
        attemptNumber: 1,
        answers: [{ questionId: "q1", answer: "5" }],
        score: 0,
        totalMarks: 4,
        percentage: 0,
        passed: false,
        correctCount: 0,
        incorrectCount: 1,
        unansweredCount: 2,
        submittedAt: new Date(),
        questionAttempts: attemptOneRows
      },
      {
        id: "attempt-2",
        attemptNumber: 2,
        answers: [
          { questionId: "q1", answer: "4" },
          { questionId: "q2", answer: "Paris" }
        ],
        score: 3,
        totalMarks: 4,
        percentage: 75,
        passed: true,
        correctCount: 2,
        incorrectCount: 0,
        unansweredCount: 1,
        submittedAt: new Date(),
        questionAttempts: attemptTwoRows
      }
    ]
  });

  const latest = await quizService.getQuizResult("student-1", quiz.id);
  assert.strictEqual(latest.attemptNumber, 2);
  assert.strictEqual(latest.questionAttempts.length, 3);
  assert.strictEqual(latest.summary.answeredCount, 2);
  assert.strictEqual(latest.summary.correctCount, 2);
  assert.strictEqual(latest.summary.skippedCount, 0);
  assert.strictEqual(latest.summary.marksObtained, 3);

  // The earlier attempt reads back as it was submitted, not as the latest one.
  const earlier = await quizService.getQuizResult("student-1", quiz.id, "attempt-1");
  assert.strictEqual(earlier.attemptNumber, 1);
  assert.strictEqual(earlier.summary.correctCount, 0);
  assert.strictEqual(earlier.summary.skippedCount, 1);
  assert.strictEqual(earlier.summary.answeredCount, 1);
  assert.strictEqual(earlier.summary.notVisitedCount, 2);
});

test("getQuizResult — an attempt from before tracking still reports a summary", async (t) => {
  const quiz = buildQuiz();

  stubResult(t, {
    quiz,
    attempts: [
      {
        id: "attempt-old",
        attemptNumber: 1,
        answers: [{ questionId: "q1", answer: "4" }],
        score: 2,
        totalMarks: 4,
        percentage: 50,
        passed: true,
        correctCount: 1,
        incorrectCount: 0,
        unansweredCount: 2,
        submittedAt: new Date(),
        // No question-level records were kept for it.
        questionAttempts: []
      }
    ]
  });

  const result = await quizService.getQuizResult("student-1", quiz.id);

  assert.strictEqual(result.questionAttempts.length, 3, "reconstructed from its stored answers");
  assert.strictEqual(result.summary.answeredCount, 1);
  assert.strictEqual(result.summary.correctCount, 1);
  assert.strictEqual(result.summary.marksObtained, 2);
  // Visit and skip history was never captured for it and is not invented.
  assert.strictEqual(result.summary.skippedCount, 0);
});
