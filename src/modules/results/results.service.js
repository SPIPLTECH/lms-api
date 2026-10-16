const prisma = require("../../config/database");
const {
  BREADCRUMB_INCLUDE,
  resolveBreadcrumb,
} = require("../../utils/helpers/courseBreadcrumb.helper");


/**
 * The courses whose results this caller may see.
 *
 * An instructor is scoped to courses they created. An admin is not scoped:
 * these routes already admit ADMIN, but filtering on `creatorId` meant an
 * admin who happened not to have authored any course saw an empty results
 * page rather than everything. Every other access check in the LMS
 * (assertCourseProgressAccess, for one) returns early for ADMIN, so this
 * brings results in line rather than inventing a rule.
 */
const resolveCourseIds = async (callingUser, courseId) => {
  const isAdmin = typeof callingUser === "object" && callingUser?.role === "ADMIN";
  // Historically this took a bare instructor id; both shapes still work so
  // callers can be migrated one at a time.
  const instructorId = typeof callingUser === "object" ? callingUser?.id : callingUser;

  const courses = await prisma.course.findMany({
    where: {
      ...(isAdmin ? {} : { creatorId: instructorId }),
      ...(courseId ? { id: courseId } : {})
    },
    select: { id: true }
  });
  return courses.map((c) => c.id);
};

/** Student profile ids enrolled in a batch, when the caller filtered by batch. */
const resolveBatchStudentIds = async (batchId) => {
  if (!batchId) return null;
  const batch = await prisma.batch.findUnique({
    where: { id: batchId },
    select: { students: { select: { id: true } } }
  });
  return batch ? batch.students.map((s) => s.id) : [];
};

const dateRangeWhere = (startDate, endDate) => {
  if (!startDate && !endDate) return undefined;
  const range = {};
  if (startDate) range.gte = new Date(startDate);
  if (endDate) range.lte = new Date(endDate);
  return range;
};

// Quiz tags a caller may filter by; anything else is ignored rather than
// passed to Prisma (where an unknown enum value would throw). QUALIFYING is
// filterable like the rest: these submissions already appeared in the
// unfiltered list (nothing ever excluded them), they just arrived looking
// like ordinary quiz results, so an instructor could not tell that a row was
// a student testing out of a lesson rather than sitting its assessment.
const QUIZ_TAGS = ["FINAL", "SELF_TEST", "QUALIFYING"];

const getResults = async (callingUser, filters = {}) => {
  const { courseId, batchId, quizId, assignmentId, studentId, startDate, endDate } = filters;
  const quizTag = QUIZ_TAGS.includes(filters.quizTag) ? filters.quizTag : undefined;

  const courseIds = await resolveCourseIds(callingUser, courseId);
  const batchStudentIds = await resolveBatchStudentIds(batchId);

  if (courseIds.length === 0 || batchStudentIds?.length === 0) {
    return emptyResult();
  }

  const submittedAtRange = dateRangeWhere(startDate, endDate);

  const quizWhere = {
    courseId: { in: courseIds },
    ...(quizId ? { id: quizId } : {}),
    // e.g. quizTag=FINAL: only formal Final tests, never learner Self-Tests.
    ...(quizTag ? { quizTag } : {})
  };

  const submissionWhere = {
    quiz: quizWhere,
    ...(studentId ? { studentId } : {}),
    ...(batchStudentIds ? { studentId: { in: batchStudentIds } } : {}),
    ...(submittedAtRange ? { submittedAt: submittedAtRange } : {})
  };

  const submissions = await prisma.quizSubmission.findMany({
    where: submissionWhere,
    include: {
      quiz: {
        select: {
          id: true,
          title: true,
          passingScore: true,
          // What kind of quiz this row actually is, and — for a qualifying
          // test — which lesson/topic the student was testing out of.
          quizTag: true,
          lesson: { select: { id: true, title: true } },
          topic: { select: { id: true, title: true } },
          course: { select: { id: true, title: true } },
          quizQuestions: {
            select: {
              question: {
                select: { id: true, question: true, topic: true, correctAnswer: true, questionType: true }
              }
            }
          }
        }
      },
      student: { include: { user: { select: { id: true, name: true, email: true } } } }
    },
    orderBy: { submittedAt: "desc" }
  });

  // Scope for the enrolled-student denominator behind completionRate.
  const enrollmentWhere = {
    courseId: { in: courseIds },
    ...(batchStudentIds ? { studentId: { in: batchStudentIds } } : {})
  };
  const enrolledCount = await prisma.enrollment.count({ where: enrollmentWhere });

  const scores = submissions.map((s) => s.percentage);
  const avgScore = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
  const highestScore = scores.length ? Math.max(...scores) : 0;
  const lowestScore = scores.length ? Math.min(...scores) : 0;
  const passPercentage = submissions.length
    ? Math.round((submissions.filter((s) => s.passed).length / submissions.length) * 100)
    : 0;
  const distinctStudentsSubmitted = new Set(submissions.map((s) => s.studentId)).size;
  const completionRate = enrolledCount > 0 ? Math.round((distinctStudentsSubmitted / enrolledCount) * 100) : 0;

  // Pending evaluations — ungraded Assignment submissions in the same scope (quizzes
  // auto-score at submit time, so this is the only real "awaiting instructor review" signal).
  const pendingEvaluations = await prisma.assignmentSubmission.count({
    where: {
      assignment: {
        courseId: { in: courseIds },
        ...(assignmentId ? { id: assignmentId } : {})
      },
      grade: null,
      ...(studentId ? { studentId } : {}),
      ...(batchStudentIds ? { studentId: { in: batchStudentIds } } : {})
    }
  });

  // A qualifying test is a student testing OUT of a lesson, so an instructor
  // needs more than score: which attempt this was, and whether they leaned on
  // hints (available from attempt 2). Both already live on the Phase 1 attempt
  // log, so they are read from there rather than stored again. Scoped to
  // qualifying rows only — ordinary quiz reporting is unchanged, and the two
  // extra queries don't run at all when there are none.
  const qualifyingSubmissions = submissions.filter((s) => s.quiz?.quizTag === "QUALIFYING");
  const attemptDetailByKey = new Map();

  if (qualifyingSubmissions.length > 0) {
    const attempts = await prisma.quizAttempt.findMany({
      where: {
        quizId: { in: [...new Set(qualifyingSubmissions.map((s) => s.quiz.id))] },
        studentId: { in: [...new Set(qualifyingSubmissions.map((s) => s.studentId))] }
      },
      select: { id: true, quizId: true, studentId: true, attemptNumber: true, passed: true },
      orderBy: { attemptNumber: "asc" }
    });

    const hintCounts = attempts.length
      ? await prisma.questionAttempt.groupBy({
          by: ["quizAttemptId"],
          where: { quizAttemptId: { in: attempts.map((a) => a.id) }, hintViewed: true },
          _count: { _all: true }
        })
      : [];
    const hintsByAttemptId = new Map(hintCounts.map((h) => [h.quizAttemptId, h._count._all]));

    for (const attempt of attempts) {
      const key = `${attempt.studentId}:${attempt.quizId}`;
      const prior = attemptDetailByKey.get(key);
      attemptDetailByKey.set(key, {
        // The submission row mirrors the LATEST attempt, so that is the one
        // whose number and hint count belong on this row.
        attemptNumber: attempt.attemptNumber,
        hintsUsed: hintsByAttemptId.get(attempt.id) ?? 0,
        totalAttempts: (prior?.totalAttempts ?? 0) + 1,
        everPassed: (prior?.everPassed ?? false) || attempt.passed === true
      });
    }
  }

  const studentResults = submissions.map((s) => {
    const isQualifying = s.quiz?.quizTag === "QUALIFYING";
    const detail = isQualifying ? attemptDetailByKey.get(`${s.studentId}:${s.quiz.id}`) : null;
    // A qualifying quiz's scope column names its TARGET — the lesson or topic
    // the student is testing out of — not a container it sits inside.
    const target = isQualifying ? s.quiz.topic || s.quiz.lesson || null : null;

    return {
      type: "Quiz",
      submissionId: s.id,
      studentId: s.studentId,
      studentName: s.student?.user?.name || "—",
      studentEmail: s.student?.user?.email || "",
      quizId: s.quiz?.id,
      title: s.quiz?.title,
      quizTag: s.quiz?.quizTag || "FINAL",
      courseId: s.quiz?.course?.id || null,
      courseTitle: s.quiz?.course?.title || "",
      score: s.score,
      totalMarks: s.totalMarks,
      percentage: s.percentage,
      passed: s.passed,
      submittedAt: s.submittedAt,
      // Null on every ordinary quiz, so existing rendering is untouched.
      qualifyingTarget: target
        ? { kind: s.quiz.topic ? "TOPIC" : "LESSON", id: target.id, title: target.title }
        : null,
      attemptNumber: detail?.attemptNumber ?? null,
      totalAttempts: detail?.totalAttempts ?? null,
      hintsUsed: detail?.hintsUsed ?? null,
      qualified: isQualifying ? detail?.everPassed ?? s.passed : null
    };
  });

  // Scoped to exactly the quizzes and students the submission list above
  // covers, so the analysis can never describe a wider set than the caller is
  // authorized to see.
  const { questionWise, topicWise } = await buildQuestionAndTopicAnalysis(
    [...new Set(submissions.map((s) => s.quiz?.id).filter(Boolean))],
    studentId ? [studentId] : batchStudentIds || null
  );

  return {
    summary: {
      avgScore,
      highestScore,
      lowestScore,
      passPercentage,
      completionRate,
      pendingEvaluations,
      totalSubmissions: submissions.length
    },
    studentResults,
    questionWise,
    topicWise
  };
};

/**
 * Question- and topic-level analysis for the submissions in scope.
 *
 * Counted from the QuestionAttempt records rather than re-graded from
 * `QuizSubmission.answers`, which is what this used to do. That mattered for
 * three reasons, all of them wrong answers rather than style:
 *
 *  - QuizSubmission holds only the LATEST attempt, so every earlier attempt
 *    was missing from the numbers. "Attempts: 84" meant 84 students, not 84
 *    responses.
 *  - A question the student left blank was skipped outright (`if (!answer)
 *    return`), so skipped and unanswered questions could not be reported at
 *    all — and those are exactly the signals an instructor needs.
 *  - Correctness was recomputed with evaluateAnswer, duplicating a decision
 *    the server already made and stored at submit time. Two graders can
 *    disagree; one cannot.
 *
 * Aggregated in the database, grouped by question, so this scales with the
 * number of questions rather than the number of attempts.
 */
const buildQuestionAndTopicAnalysis = async (quizIds, studentIds = null) => {
  if (!quizIds || quizIds.length === 0) return { questionWise: [], topicWise: [] };

  const where = {
    quizAttempt: {
      quizId: { in: quizIds },
      ...(studentIds ? { studentId: { in: studentIds } } : {})
    }
  };

  const [responses, correct, skipped, hinted, questions] = await Promise.all([
    prisma.questionAttempt.groupBy({ by: ["questionId"], where, _count: { _all: true } }),
    prisma.questionAttempt.groupBy({
      by: ["questionId"],
      where: { ...where, isCorrect: true },
      _count: { _all: true }
    }),
    prisma.questionAttempt.groupBy({
      by: ["questionId"],
      where: { ...where, skipped: true },
      _count: { _all: true }
    }),
    prisma.questionAttempt.groupBy({
      by: ["questionId"],
      where: { ...where, hintViewed: true },
      _count: { _all: true }
    }),
    prisma.question.findMany({
      where: { quizQuestions: { some: { quizId: { in: quizIds } } } },
      select: { id: true, question: true, topic: true }
    })
  ]);

  const countOf = (rows) => new Map(rows.map((r) => [r.questionId, r._count._all]));
  const responseCount = countOf(responses);
  const correctCount = countOf(correct);
  const skippedCount = countOf(skipped);
  const hintedCount = countOf(hinted);

  const topicStats = new Map();

  const questionWise = questions
    .filter((q) => (responseCount.get(q.id) ?? 0) > 0)
    .map((q) => {
      const attempts = responseCount.get(q.id) ?? 0;
      const correctN = correctCount.get(q.id) ?? 0;
      const skippedN = skippedCount.get(q.id) ?? 0;
      const hintsN = hintedCount.get(q.id) ?? 0;
      const topicKey = q.topic || "Uncategorized";

      if (!topicStats.has(topicKey)) {
        topicStats.set(topicKey, { topic: topicKey, attempts: 0, correct: 0, skipped: 0, hintsUsed: 0 });
      }
      const tStat = topicStats.get(topicKey);
      tStat.attempts += attempts;
      tStat.correct += correctN;
      tStat.skipped += skippedN;
      tStat.hintsUsed += hintsN;

      return {
        questionId: q.id,
        question: q.question,
        topic: topicKey,
        attempts,
        correct: correctN,
        // Kept distinct from `correct`/incorrect on purpose: choosing to move
        // past a question is not the same as getting it wrong.
        skipped: skippedN,
        hintsUsed: hintsN,
        accuracy: attempts > 0 ? Math.round((correctN / attempts) * 100) : 0
      };
    })
    .sort((a, b) => a.accuracy - b.accuracy || b.attempts - a.attempts);

  const topicWise = Array.from(topicStats.values()).map((t) => ({
    ...t,
    accuracy: t.attempts > 0 ? Math.round((t.correct / t.attempts) * 100) : 0
  }));

  return { questionWise, topicWise };
};

/**
 * Final tests grouped BY TEST rather than by attempt, for the instructor
 * Grading & Results view: one row per test with its Course / Module / Lesson /
 * Topic breadcrumb, a submission gauge, and the student roster behind it.
 *
 * Deliberately different from getResults, which returns one flat row per
 * ATTEMPT and a single scope-wide completionRate. Here every enrolled student
 * appears whether or not they attempted — otherwise the gauge and the table it
 * opens would disagree about the denominator.
 *
 * Quizzes may allow several attempts, so the row shown per student is their
 * LATEST attempt, with attemptsCount alongside it.
 */
const getFinalTestOverview = async (callingUser, { courseId, quizId } = {}) => {
  const courseIds = await resolveCourseIds(callingUser, courseId);
  if (courseIds.length === 0) return [];

  const quizzes = await prisma.quiz.findMany({
    // quizId narrows to a single test for the detail page, still scoped to the
    // instructor's own courses so it cannot be used to read another's.
    where: { courseId: { in: courseIds }, quizTag: "FINAL", ...(quizId ? { id: quizId } : {}) },
    include: BREADCRUMB_INCLUDE,
    orderBy: { createdAt: "desc" }
  });
  if (quizzes.length === 0) return [];

  // The roster is the enrolled students of each quiz's course. Batches are not
  // consulted — they have been removed from the product surface.
  const enrollments = await prisma.enrollment.findMany({
    where: { courseId: { in: courseIds } },
    select: {
      courseId: true,
      student: { select: { id: true, user: { select: { name: true, email: true } } } }
    }
  });

  const rosterByCourse = new Map();
  for (const e of enrollments) {
    if (!rosterByCourse.has(e.courseId)) rosterByCourse.set(e.courseId, []);
    rosterByCourse.get(e.courseId).push({
      studentId: e.student.id,
      studentName: e.student.user?.name || "Student",
      studentEmail: e.student.user?.email || ""
    });
  }

  const submissions = await prisma.quizSubmission.findMany({
    where: { quizId: { in: quizzes.map((q) => q.id) } },
    select: {
      quizId: true,
      studentId: true,
      score: true,
      totalMarks: true,
      percentage: true,
      passed: true,
      submittedAt: true
    },
    orderBy: { submittedAt: "desc" }
  });

  // Newest first, so the FIRST row seen for a student is their latest attempt.
  const latestByQuizStudent = new Map();
  const attemptsByQuizStudent = new Map();
  // The newest attempt on the test by anyone, for the "recently submitted" sort.
  const latestByQuiz = new Map();
  for (const s of submissions) {
    const key = `${s.quizId}:${s.studentId}`;
    if (!latestByQuizStudent.has(key)) latestByQuizStudent.set(key, s);
    if (!latestByQuiz.has(s.quizId)) latestByQuiz.set(s.quizId, s.submittedAt);
    attemptsByQuizStudent.set(key, (attemptsByQuizStudent.get(key) || 0) + 1);
  }

  return quizzes.map((quiz) => {
    // enrolledCount is recomputed from the roster below so the gauge can never
    // disagree with the table it opens.
    const { enrolledCount: _courseEnrolled, ...breadcrumb } = resolveBreadcrumb(quiz);
    const roster = rosterByCourse.get(quiz.courseId) || [];

    const students = roster.map((student) => {
      const key = `${quiz.id}:${student.studentId}`;
      const attempt = latestByQuizStudent.get(key) || null;

      return {
        ...student,
        attempted: Boolean(attempt),
        attemptsCount: attemptsByQuizStudent.get(key) || 0,
        score: attempt?.score ?? null,
        totalMarks: attempt?.totalMarks ?? null,
        percentage: attempt?.percentage ?? null,
        passed: attempt?.passed ?? null,
        submittedAt: attempt?.submittedAt ?? null
      };
    });

    const attemptedCount = students.filter((s) => s.attempted).length;

    return {
      id: quiz.id,
      title: quiz.title,
      passingScore: quiz.passingScore,
      ...breadcrumb,
      enrolledCount: students.length,
      attemptedCount,
      notAttemptedCount: students.length - attemptedCount,
      failedCount: students.filter((s) => s.attempted && s.passed === false).length,
      lastSubmittedAt: latestByQuiz.get(quiz.id) || null,
      students
    };
  });
};

const emptyResult = () => ({
  summary: {
    avgScore: 0,
    highestScore: 0,
    lowestScore: 0,
    passPercentage: 0,
    completionRate: 0,
    pendingEvaluations: 0,
    totalSubmissions: 0
  },
  studentResults: [],
  questionWise: [],
  topicWise: []
});

module.exports = {
  getResults,
  getFinalTestOverview
};
