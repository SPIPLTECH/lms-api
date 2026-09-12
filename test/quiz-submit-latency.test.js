const test = require("node:test");
const assert = require("node:assert");

const prisma = require("../src/config/database");
const quizService = require("../src/modules/quizzes/quiz.service");
const notificationService = require("../src/modules/notifications/notification.service");
const learnerModelService = require("../src/modules/learner-model/learnerModel.service");
const progressRollup = require("../src/utils/progressRollup");

// The invariant under test: submitQuiz answers the HTTP caller as soon as the
// QuizAttempt transaction has committed. Everything after it — the course
// progress rollup, the per-question learner-model evidence, the instructor
// notification — is a side effect the student's browser must never wait on.
//
// Why it matters: the DB is remote (~100ms per round trip) and the rollup
// alone fans out into ~16 relation queries plus a per-topic upsert each. When
// that ran inline the response crossed the client's 15s axios timeout, the UI
// told the student their answers hadn't been submitted, and they resubmitted
// a quiz that had in fact already been recorded — burning a real attempt.

const SIDE_EFFECT_DELAY_MS = 200;
const MAX_ACCEPTABLE_RESPONSE_MS = 100;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const buildQuiz = () => ({
  id: "quiz-1",
  courseId: "course-1",
  title: "Latency Quiz",
  passingScore: 50,
  attempts: 0,
  quizTag: "FINAL",
  quizQuestions: [
    {
      marks: 1,
      question: {
        id: "question-1",
        question: "2 + 2?",
        questionType: "MCQ",
        options: ["4", "5"],
        correctAnswer: "4",
        topic: "arithmetic",
        marks: 1
      }
    }
  ]
});

test("submitQuiz returns once the attempt is committed, deferring side effects", async (t) => {
  const originals = {
    quizFindUnique: prisma.quiz.findUnique,
    transaction: prisma.$transaction,
    quizProgressFindUnique: prisma.quizProgress.findUnique,
    quizProgressUpsert: prisma.quizProgress.upsert,
    courseFindUnique: prisma.course.findUnique,
    studentProfileFindUnique: prisma.studentProfile.findUnique,
    createNotification: notificationService.createNotification,
    recordEvidence: learnerModelService.recordEvidence,
    recomputeCourseProgress: progressRollup.recomputeCourseProgress
  };

  t.after(() => {
    prisma.quiz.findUnique = originals.quizFindUnique;
    prisma.$transaction = originals.transaction;
    prisma.quizProgress.findUnique = originals.quizProgressFindUnique;
    prisma.quizProgress.upsert = originals.quizProgressUpsert;
    prisma.course.findUnique = originals.courseFindUnique;
    prisma.studentProfile.findUnique = originals.studentProfileFindUnique;
    notificationService.createNotification = originals.createNotification;
    learnerModelService.recordEvidence = originals.recordEvidence;
    progressRollup.recomputeCourseProgress = originals.recomputeCourseProgress;
  });

  const ran = { rollup: 0, evidence: 0, notification: 0 };

  prisma.quiz.findUnique = async () => buildQuiz();

  // A committed transaction, with no artificial delay: this is the only work
  // the caller is allowed to wait for.
  prisma.$transaction = async (fn) => {
    const tx = {
      quizAttempt: {
        findFirst: async () => null,
        create: async ({ data }) => ({ id: "attempt-1", submittedAt: new Date(), ...data })
      },
      quizSubmission: {
        findUnique: async () => null,
        upsert: async ({ create }) => ({ id: "submission-1", ...create })
      }
    };
    return fn(tx);
  };

  // Each side effect is slow enough that awaiting any one of them would blow
  // the budget below.
  progressRollup.recomputeCourseProgress = async () => {
    await delay(SIDE_EFFECT_DELAY_MS);
    ran.rollup++;
  };
  learnerModelService.recordEvidence = async () => {
    await delay(SIDE_EFFECT_DELAY_MS);
    ran.evidence++;
    return { recordedMisconception: null };
  };
  notificationService.createNotification = async () => {
    await delay(SIDE_EFFECT_DELAY_MS);
    ran.notification++;
  };

  prisma.quizProgress.findUnique = async () => null;
  prisma.quizProgress.upsert = async () => ({});
  prisma.course.findUnique = async () => ({ title: "Course", creatorId: "instructor-1" });
  prisma.studentProfile.findUnique = async () => ({ user: { name: "Student" } });

  const answers = [{ questionId: "question-1", answer: "4" }];

  const startedAt = Date.now();
  const submission = await quizService.submitQuiz("student-1", "quiz-1", answers, 42);
  const elapsed = Date.now() - startedAt;

  await t.test("the caller is not made to wait for the side effects", () => {
    assert.ok(
      elapsed < MAX_ACCEPTABLE_RESPONSE_MS,
      `submitQuiz took ${elapsed}ms; it must return in under ${MAX_ACCEPTABLE_RESPONSE_MS}ms ` +
        `rather than awaiting the deferred work`
    );
  });

  await t.test("the committed attempt is still what comes back", () => {
    assert.strictEqual(submission.id, "submission-1");
    assert.strictEqual(submission.attemptId, "attempt-1");
    assert.strictEqual(submission.attemptNumber, 1);
  });

  await t.test("the deferred work still runs, and is awaitable", async () => {
    await quizService.flushPendingSubmissionSideEffects();
    assert.strictEqual(ran.rollup, 1, "progress rollup should have run");
    assert.strictEqual(ran.evidence, 1, "learner-model evidence should have been recorded");
    assert.strictEqual(ran.notification, 1, "the instructor should have been notified");
  });
});
