const prisma = require("../../config/database");
const { resolveQualificationTarget, QUALIFYING_TAG } = require("../../utils/qualification");

/**
 * Instructor analytics for one quiz — how the cohort did, and where individual
 * questions are hurting them.
 *
 * Everything is derived from the Phase 1 records: QuizAttempt for the
 * attempt-level figures, QuestionAttempt for the question-level ones. Nothing
 * is stored for analytics and nothing is re-graded here — `isCorrect`,
 * `skipped`, `hintViewed` and `marksObtained` were all decided server-side at
 * submit time and are simply counted.
 *
 * That matters for correctness as much as for tidiness. The analytics this
 * replaces folded `QuizSubmission` (the latest-attempt mirror), so earlier
 * attempts were invisible, and it skipped any question the student left blank,
 * so "skipped" and "unanswered" could not be reported at all.
 *
 * Aggregation happens in the database. A popular quiz can easily hold tens of
 * thousands of QuestionAttempt rows across its attempts, and pulling those
 * into Node to count them would scale with cohort size for numbers Postgres
 * can produce in one pass.
 */

/** Percentage of `part` out of `whole`, one decimal, 0 when there is nothing. */
const rate = (part, whole) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);

/**
 * The quizzes this caller is allowed to see, as a Prisma `where` fragment.
 *
 * An instructor is scoped to courses they created. An admin is not scoped —
 * the same rule assertCourseProgressAccess applies everywhere else in the LMS,
 * where ADMIN returns early rather than being filtered by ownership. Scoping
 * happens here, in the query, so an unauthorized quizId returns nothing rather
 * than relying on the caller to filter.
 */
const buildQuizScope = (callingUser, { quizId = null, courseId = null } = {}) => {
  const scope = {
    ...(quizId ? { id: quizId } : {}),
    ...(courseId ? { courseId } : {})
  };
  if (callingUser?.role === "ADMIN") return scope;
  return { ...scope, course: { creatorId: callingUser?.id ?? "__none__" } };
};

/** Attempt-level figures for the quiz, straight from the attempt log. */
const buildAttemptStats = (attempts) => {
  const percentages = attempts.map((a) => a.percentage);
  const passed = attempts.filter((a) => a.passed === true).length;
  const timed = attempts.filter((a) => Number.isFinite(a.timeTakenSeconds));

  return {
    totalAttempts: attempts.length,
    uniqueStudents: new Set(attempts.map((a) => a.studentId)).size,
    averageScore: percentages.length
      ? Math.round(percentages.reduce((sum, p) => sum + p, 0) / percentages.length)
      : 0,
    highestScore: percentages.length ? Math.max(...percentages) : 0,
    lowestScore: percentages.length ? Math.min(...percentages) : 0,
    passCount: passed,
    failCount: attempts.length - passed,
    passRate: rate(passed, attempts.length),
    failRate: rate(attempts.length - passed, attempts.length),
    // Null rather than 0 when nothing was measured — "no data" and "instant"
    // are different facts, and the UI shows a dash for the former.
    averageCompletionSeconds: timed.length
      ? Math.round(timed.reduce((sum, a) => sum + a.timeTakenSeconds, 0) / timed.length)
      : null
  };
};

/**
 * Per-question counts, grouped by the database.
 *
 * Six narrow groupBy passes rather than one wide scan: each is an index-backed
 * count over the same filtered set, and together they cost far less than
 * shipping every row to Node. `responses` counts every record — a question a
 * student never reached still has a row (NOT_VISITED), which is what makes
 * "skipped" and "never reached" separable.
 */
const fetchQuestionCounts = async (quizId) => {
  const where = { quizAttempt: { quizId } };

  const [responses, answered, correct, incorrect, skipped, hinted] = await Promise.all([
    prisma.questionAttempt.groupBy({ by: ["questionId"], where, _count: { _all: true } }),
    prisma.questionAttempt.groupBy({
      by: ["questionId"],
      where: { ...where, answered: true },
      _count: { _all: true }
    }),
    prisma.questionAttempt.groupBy({
      by: ["questionId"],
      where: { ...where, isCorrect: true },
      _count: { _all: true }
    }),
    prisma.questionAttempt.groupBy({
      by: ["questionId"],
      where: { ...where, answered: true, isCorrect: false },
      _count: { _all: true }
    }),
    // The student's own Skip action. Deliberately NOT merged with
    // "unanswered": deciding to move past a question is a different signal
    // from running out of time, and collapsing them would hide which it was.
    prisma.questionAttempt.groupBy({
      by: ["questionId"],
      where: { ...where, skipped: true },
      _count: { _all: true }
    }),
    prisma.questionAttempt.groupBy({
      by: ["questionId"],
      where: { ...where, hintViewed: true },
      _count: { _all: true }
    })
  ]);

  const toMap = (rows) => new Map(rows.map((r) => [r.questionId, r._count._all]));
  return {
    responses: toMap(responses),
    answered: toMap(answered),
    correct: toMap(correct),
    incorrect: toMap(incorrect),
    skipped: toMap(skipped),
    hinted: toMap(hinted)
  };
};

/**
 * Average seconds between first opening a question and answering it.
 *
 * Only rows that carry both timestamps count — a question answered without a
 * recorded visit, or never answered, has no measurable duration and must not
 * be averaged in as zero. Computed in SQL so the timestamps never leave the
 * database. Negative spans (clock skew on the client that reported them) are
 * discarded rather than dragging the average down.
 */
const fetchQuestionTimes = async (quizId) => {
  const rows = await prisma.$queryRaw`
    SELECT qa."questionId" AS "questionId",
           AVG(EXTRACT(EPOCH FROM (qa."answeredAt" - qa."firstVisitedAt"))) AS "avgSeconds"
      FROM "QuestionAttempt" qa
      JOIN "QuizAttempt" a ON a."id" = qa."quizAttemptId"
     WHERE a."quizId" = ${quizId}
       AND qa."answeredAt" IS NOT NULL
       AND qa."firstVisitedAt" IS NOT NULL
       AND qa."answeredAt" >= qa."firstVisitedAt"
     GROUP BY qa."questionId"
  `;

  return new Map(
    rows
      .filter((r) => r.avgSeconds !== null)
      .map((r) => [r.questionId, Math.round(Number(r.avgSeconds))])
  );
};

/**
 * How often each distinct answer was chosen, per question — the misconception
 * signal: an incorrect option that attracts most of the cohort is usually a
 * teaching problem, not a careless-mistake problem.
 *
 * Grouped in SQL on the jsonb column, so the raw answers are never loaded.
 * Only answered rows count; a blank is not a choice.
 */
const fetchOptionDistribution = async (quizId) => {
  const rows = await prisma.$queryRaw`
    SELECT qa."questionId" AS "questionId",
           qa."answer"::text AS "answer",
           COUNT(*)::int AS "count"
      FROM "QuestionAttempt" qa
      JOIN "QuizAttempt" a ON a."id" = qa."quizAttemptId"
     WHERE a."quizId" = ${quizId}
       AND qa."answered" = true
       AND qa."answer" IS NOT NULL
     GROUP BY 1, 2
  `;

  const byQuestion = new Map();
  for (const row of rows) {
    let value;
    try {
      // The column is jsonb, so a plain string answer comes back quoted.
      value = JSON.parse(row.answer);
    } catch {
      value = row.answer;
    }
    const label = typeof value === "string" ? value : JSON.stringify(value);
    if (!byQuestion.has(row.questionId)) byQuestion.set(row.questionId, []);
    byQuestion.get(row.questionId).push({ option: label, count: row.count });
  }

  for (const [questionId, options] of byQuestion) {
    const total = options.reduce((sum, o) => sum + o.count, 0);
    byQuestion.set(
      questionId,
      options
        .map((o) => ({ ...o, percentage: rate(o.count, total) }))
        .sort((a, b) => b.count - a.count || a.option.localeCompare(b.option))
    );
  }

  return byQuestion;
};

/**
 * Qualifying-test specifics: what it lets students skip, and how hard it is
 * proving to qualify.
 *
 * `averageAttemptsToQualify` counts only students who actually qualified —
 * averaging in students still trying would report a number that drifts down
 * as they keep failing, which reads backwards.
 */
const buildQualifyingStats = async (quiz, attempts) => {
  const target = resolveQualificationTarget(quiz);
  if (!target) return null;

  const [lesson, topic] = await Promise.all([
    quiz.lessonId
      ? prisma.lesson.findUnique({ where: { id: quiz.lessonId }, select: { id: true, title: true } })
      : null,
    quiz.topicId
      ? prisma.topic.findUnique({ where: { id: quiz.topicId }, select: { id: true, title: true } })
      : null
  ]);

  const byStudent = new Map();
  for (const attempt of attempts) {
    if (!byStudent.has(attempt.studentId)) byStudent.set(attempt.studentId, []);
    byStudent.get(attempt.studentId).push(attempt);
  }

  const attemptsToQualify = [];
  let qualifiedStudents = 0;
  for (const studentAttempts of byStudent.values()) {
    const ordered = [...studentAttempts].sort((a, b) => a.attemptNumber - b.attemptNumber);
    const firstPass = ordered.find((a) => a.passed === true);
    if (firstPass) {
      qualifiedStudents += 1;
      attemptsToQualify.push(firstPass.attemptNumber);
    }
  }

  return {
    target: {
      kind: target.kind,
      id: target.id,
      title: (target.kind === "TOPIC" ? topic?.title : lesson?.title) ?? null
    },
    studentsAttempted: byStudent.size,
    qualifiedStudents,
    notQualifiedStudents: byStudent.size - qualifiedStudents,
    qualificationRate: rate(qualifiedStudents, byStudent.size),
    averageAttemptsToQualify: attemptsToQualify.length
      ? Math.round(
          (attemptsToQualify.reduce((sum, n) => sum + n, 0) / attemptsToQualify.length) * 10
        ) / 10
      : null
  };
};

/**
 * Concepts the cohort is weakest on, from the questions' own `topic` field —
 * the same field the learner model uses as its KC, so analytics and the
 * adaptive engine are talking about the same thing. Analytics only reads it;
 * nothing here feeds back into mastery or progression.
 */
const buildWeakAreas = (questions) => {
  const byConcept = new Map();

  for (const question of questions) {
    // The mapped question exposes the KC as `concept` (Question.topic is the
    // raw column); reading `.topic` here silently matched nothing.
    const concept = (question.concept || "").trim();
    if (!concept || concept.toLowerCase() === "general") continue;

    if (!byConcept.has(concept)) {
      byConcept.set(concept, { concept, responses: 0, correct: 0, skipped: 0, hintsUsed: 0 });
    }
    const entry = byConcept.get(concept);
    entry.responses += question.responses;
    entry.correct += question.correct;
    entry.skipped += question.skipped;
    entry.hintsUsed += question.hintsUsed;
  }

  return [...byConcept.values()]
    .map((entry) => ({ ...entry, correctRate: rate(entry.correct, entry.responses) }))
    .filter((entry) => entry.responses > 0)
    .sort((a, b) => a.correctRate - b.correctRate || b.responses - a.responses);
};

/**
 * Analytics for one quiz, or null when the caller may not see it.
 *
 * INSTRUCTOR/ADMIN only — enforced by the route's role check and again by
 * buildQuizScope here. The answer key IS included, because the instructor
 * authors it; the qualifying-test rules that withhold it apply to the student
 * result endpoint, where the student can still retake. This endpoint is never
 * reachable by a student, so it cannot be used to work around them.
 */
const getQuizAnalytics = async (callingUser, { quizId }) => {
  if (!quizId) {
    const error = new Error("quizId is required");
    error.statusCode = 400;
    throw error;
  }

  const quiz = await prisma.quiz.findFirst({
    where: buildQuizScope(callingUser, { quizId }),
    select: {
      id: true,
      title: true,
      quizTag: true,
      passingScore: true,
      attempts: true,
      timeLimit: true,
      lessonId: true,
      topicId: true,
      course: { select: { id: true, title: true } },
      quizQuestions: {
        orderBy: { order: "asc" },
        select: {
          order: true,
          marks: true,
          question: {
            select: {
              id: true,
              question: true,
              questionType: true,
              topic: true,
              options: true,
              correctAnswer: true
            }
          }
        }
      }
    }
  });

  // Not found and not-allowed are deliberately the same answer: telling an
  // instructor that a quiz exists but belongs to someone else is itself a leak.
  if (!quiz) return null;

  const attempts = await prisma.quizAttempt.findMany({
    where: { quizId },
    select: {
      id: true,
      studentId: true,
      attemptNumber: true,
      percentage: true,
      passed: true,
      timeTakenSeconds: true
    }
  });

  // An empty quiz, or one nobody has attempted, is a legitimate state — it
  // reports zeroes rather than failing.
  const hasAttempts = attempts.length > 0;
  const [counts, times, optionsByQuestion] = hasAttempts
    ? await Promise.all([
        fetchQuestionCounts(quizId),
        fetchQuestionTimes(quizId),
        fetchOptionDistribution(quizId)
      ])
    : [
        { responses: new Map(), answered: new Map(), correct: new Map(), incorrect: new Map(), skipped: new Map(), hinted: new Map() },
        new Map(),
        new Map()
      ];

  const questions = (quiz.quizQuestions || []).map((qq) => {
    const question = qq.question;
    const responses = counts.responses.get(question.id) ?? 0;
    const answered = counts.answered.get(question.id) ?? 0;
    const correct = counts.correct.get(question.id) ?? 0;
    const incorrect = counts.incorrect.get(question.id) ?? 0;
    const skipped = counts.skipped.get(question.id) ?? 0;
    const hintsUsed = counts.hinted.get(question.id) ?? 0;

    return {
      questionId: question.id,
      order: qq.order,
      question: question.question,
      questionType: question.questionType,
      concept: question.topic || null,
      marks: qq.marks,
      responses,
      answered,
      correct,
      incorrect,
      skipped,
      // Left blank without being skipped — ran out of time, or never reached.
      unanswered: responses - answered,
      hintsUsed,
      // Rates are over every response, so they sum meaningfully with the
      // skip rate instead of silently excluding the students who didn't answer.
      correctRate: rate(correct, responses),
      incorrectRate: rate(incorrect, responses),
      skipRate: rate(skipped, responses),
      hintRate: rate(hintsUsed, responses),
      averageSeconds: times.get(question.id) ?? null,
      optionDistribution: optionsByQuestion.get(question.id) ?? [],
      correctAnswer: question.correctAnswer
    };
  });

  const attemptStats = buildAttemptStats(attempts);
  const totalResponses = questions.reduce((sum, q) => sum + q.responses, 0);
  const totalAnswered = questions.reduce((sum, q) => sum + q.answered, 0);
  const totalSkipped = questions.reduce((sum, q) => sum + q.skipped, 0);
  const totalHints = questions.reduce((sum, q) => sum + q.hintsUsed, 0);

  return {
    quiz: {
      id: quiz.id,
      title: quiz.title,
      quizTag: quiz.quizTag,
      passingScore: quiz.passingScore,
      maxAttempts: quiz.attempts,
      timeLimit: quiz.timeLimit,
      course: quiz.course
    },
    summary: {
      ...attemptStats,
      totalQuestions: questions.length,
      // Per attempt, not per student — the honest denominator for "how much of
      // this quiz does a typical sitting actually get through".
      averageAttemptedQuestions: attemptStats.totalAttempts
        ? Math.round((totalAnswered / attemptStats.totalAttempts) * 10) / 10
        : 0,
      averageSkippedQuestions: attemptStats.totalAttempts
        ? Math.round((totalSkipped / attemptStats.totalAttempts) * 10) / 10
        : 0,
      totalHintsUsed: totalHints,
      totalResponses
    },
    questions,
    // Ordered worst-first so the questions that need attention lead. No single
    // blended "difficulty score": the underlying metrics are reported instead,
    // so an instructor can see WHY a question looks hard — widely answered
    // wrong, widely skipped, or quietly eating everyone's time.
    difficultQuestions: [...questions]
      .filter((q) => q.responses > 0)
      .sort(
        (a, b) =>
          a.correctRate - b.correctRate ||
          b.skipRate - a.skipRate ||
          b.hintRate - a.hintRate ||
          (b.averageSeconds ?? 0) - (a.averageSeconds ?? 0)
      )
      .slice(0, 10),
    weakAreas: buildWeakAreas(questions),
    qualifying: quiz.quizTag === QUALIFYING_TAG ? await buildQualifyingStats(quiz, attempts) : null
  };
};

module.exports = {
  rate,
  buildQuizScope,
  buildAttemptStats,
  buildWeakAreas,
  buildQualifyingStats,
  getQuizAnalytics
};
