const prisma = require("../config/database");
const { effectiveMaxAttempts, buildAttemptAllowance } = require("./attemptAllowance");

/**
 * Skip qualification: whether a student has passed the QUALIFYING quiz that
 * exempts them from a lesson or topic.
 *
 * There is deliberately no SkipQualification table. A qualification is not a
 * new fact — it is the Phase 1 quiz attempt log read through one question:
 * "is there a passing attempt on the QUALIFYING quiz whose target is this
 * lesson/topic?". Storing it again would be a second progress system that
 * could disagree with the attempts it was derived from, and would need its
 * own rules for the things QuizAttempt already settles: attempts are
 * immutable, numbered, capped by Quiz.attempts, and scored server-side.
 *
 * A QUALIFYING quiz names its target through the scope column it already
 * has — Quiz.topicId or Quiz.lessonId. That is also the whole of the
 * instructor's configuration: a lesson/topic is skippable exactly when a
 * published QUALIFYING quiz with questions points at it. So a quiz can only
 * ever unlock the one thing it is attached to; there is no second reference
 * that could drift and unlock something unrelated.
 *
 * Nothing here is advisory. The decision is `QuizAttempt.passed`, which the
 * quiz service computed from the quiz's own passingScore at submit time.
 */

const QUALIFYING_TAG = "QUALIFYING";

/** The scope columns a QUALIFYING quiz may target, finest first. */
const TARGET_FIELDS = ["topicId", "lessonId"];

/**
 * The lesson/topic a quiz qualifies a student to skip, or null when the quiz
 * is not a qualifying test. A quiz carrying several scope columns resolves to
 * the finest one, matching how the rest of the codebase reads quiz scope.
 */
const resolveQualificationTarget = (quiz) => {
  if (!quiz || quiz.quizTag !== QUALIFYING_TAG) return null;
  for (const field of TARGET_FIELDS) {
    if (quiz[field]) {
      return { kind: field === "topicId" ? "TOPIC" : "LESSON", id: quiz[field], field };
    }
  }
  // A qualifying quiz with no lesson/topic would exempt the student from
  // nothing. Treated as unusable rather than as a course-wide skip.
  return null;
};

/**
 * Every lesson/topic the student has qualified out of, within one course.
 *
 * Qualification is best-of-attempts: one passing attempt qualifies, and a
 * later failed retake does not take it away — the student demonstrated the
 * knowledge once, and attempts are never overwritten. Read `tx` when called
 * inside the roll-up transaction so it sees the same snapshot.
 */
const getCourseQualifications = async (studentId, courseId, tx = null) => {
  const db = tx || prisma;
  if (!studentId || !courseId) {
    return { qualifiedTopicIds: new Map(), qualifiedLessonIds: new Map() };
  }

  const passingAttempts = await db.quizAttempt.findMany({
    where: {
      studentId,
      passed: true,
      quiz: {
        courseId,
        quizTag: QUALIFYING_TAG,
        isPublished: true
      }
    },
    orderBy: { submittedAt: "asc" },
    select: {
      submittedAt: true,
      quiz: { select: { id: true, quizTag: true, topicId: true, lessonId: true } }
    }
  });

  const qualifiedTopicIds = new Map();
  const qualifiedLessonIds = new Map();

  for (const attempt of passingAttempts) {
    const target = resolveQualificationTarget(attempt.quiz);
    if (!target) continue;
    // Ordered ascending above, so the first write per target is the EARLIEST
    // passing attempt — qualifiedAt is when they first qualified, not when
    // they last happened to pass.
    const bucket = target.kind === "TOPIC" ? qualifiedTopicIds : qualifiedLessonIds;
    if (!bucket.has(target.id)) bucket.set(target.id, attempt.submittedAt);
  }

  return { qualifiedTopicIds, qualifiedLessonIds };
};

/**
 * The qualifying quizzes available in a course, keyed by the lesson/topic
 * each one targets — i.e. which lessons/topics are skippable at all.
 *
 * A quiz with no questions is left out: offering a student a test that cannot
 * be passed or failed would be a dead end, and `attempts` on an empty quiz
 * would burn allowance for nothing.
 */
/**
 * The qualifying quizzes on offer for a course.
 *
 * With a `studentId`, each entry also carries that student's standing against
 * it — attempts used, and whether another is allowed. Without one the entries
 * are exactly what they always were, so callers that do not have a student in
 * hand (dripAccess) are unaffected.
 *
 * The allowance is the shared rule (effectiveMaxAttempts), not a second
 * interpretation of Quiz.attempts, so "can they skip" here cannot disagree
 * with what submit would accept.
 */
const getCourseQualifyingQuizzes = async (courseId, tx = null, studentId = null) => {
  const db = tx || prisma;
  const byTopicId = new Map();
  const byLessonId = new Map();
  if (!courseId) return { byTopicId, byLessonId };

  const quizzes = await db.quiz.findMany({
    where: { courseId, quizTag: QUALIFYING_TAG, isPublished: true },
    select: {
      id: true,
      title: true,
      quizTag: true,
      topicId: true,
      lessonId: true,
      passingScore: true,
      attempts: true,
      timeLimit: true,
      _count: { select: { quizQuestions: true } }
    }
  });

  // One grouped query for the whole course, not one per quiz.
  const attemptsByQuiz = new Map();
  if (studentId && quizzes.length > 0) {
    const rows = await db.quizAttempt.groupBy({
      by: ["quizId"],
      where: { studentId, quizId: { in: quizzes.map((q) => q.id) } },
      _count: { _all: true }
    });
    for (const row of rows) attemptsByQuiz.set(row.quizId, row._count._all);
  }

  for (const quiz of quizzes) {
    if (quiz._count.quizQuestions === 0) continue;
    const target = resolveQualificationTarget(quiz);
    if (!target) continue;

    const entry = {
      id: quiz.id,
      title: quiz.title,
      passingScore: quiz.passingScore,
      attempts: quiz.attempts,
      timeLimit: quiz.timeLimit,
      questionCount: quiz._count.quizQuestions,
      targetKind: target.kind,
      targetId: target.id,
      // Only present when a studentId was supplied; undefined otherwise, which
      // every consumer treats as "not known here" rather than as "no".
      ...(studentId
        ? (() => {
            const used = attemptsByQuiz.get(quiz.id) ?? 0;
            const allowance = buildAttemptAllowance(effectiveMaxAttempts(quiz), used);
            return { attemptsUsed: used, canAttempt: allowance.canAttempt };
          })()
        : {})
    };
    (target.kind === "TOPIC" ? byTopicId : byLessonId).set(target.id, entry);
  }

  return { byTopicId, byLessonId };
};

module.exports = {
  QUALIFYING_TAG,
  resolveQualificationTarget,
  getCourseQualifications,
  getCourseQualifyingQuizzes
};
