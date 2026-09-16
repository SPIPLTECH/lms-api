const prisma = require("../../config/database");
const { evaluateAnswer } = require("../quizzes/quiz.service");
const {
  BREADCRUMB_INCLUDE,
  resolveBreadcrumb,
} = require("../../utils/helpers/courseBreadcrumb.helper");

/** Course ids the instructor owns, optionally narrowed to a single course. */
const resolveCourseIds = async (instructorId, courseId) => {
  const courses = await prisma.course.findMany({
    where: {
      creatorId: instructorId,
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
// passed to Prisma (where an unknown enum value would throw).
const QUIZ_TAGS = ["FINAL", "SELF_TEST"];

const getResults = async (instructorId, filters = {}) => {
  const { courseId, batchId, quizId, assignmentId, studentId, startDate, endDate } = filters;
  const quizTag = QUIZ_TAGS.includes(filters.quizTag) ? filters.quizTag : undefined;

  const courseIds = await resolveCourseIds(instructorId, courseId);
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

  const studentResults = submissions.map((s) => ({
    type: "Quiz",
    submissionId: s.id,
    studentId: s.studentId,
    studentName: s.student?.user?.name || "—",
    studentEmail: s.student?.user?.email || "",
    quizId: s.quiz?.id,
    title: s.quiz?.title,
    courseId: s.quiz?.course?.id || null,
    courseTitle: s.quiz?.course?.title || "",
    score: s.score,
    totalMarks: s.totalMarks,
    percentage: s.percentage,
    passed: s.passed,
    submittedAt: s.submittedAt
  }));

  const { questionWise, topicWise } = buildQuestionAndTopicAnalysis(submissions);

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

const buildQuestionAndTopicAnalysis = (submissions) => {
  const questionStats = new Map();
  const topicStats = new Map();

  submissions.forEach((submission) => {
    const answerMap = new Map((submission.answers || []).map((a) => [a.questionId, a.answer]));
    const questions = (submission.quiz?.quizQuestions || []).map((qq) => qq.question).filter(Boolean);

    questions.forEach((question) => {
      const answer = answerMap.get(question.id);
      if (answer === undefined || answer === null || answer === "") return;

      const isCorrect = evaluateAnswer(answer, question.correctAnswer, question.questionType) > 0;

      if (!questionStats.has(question.id)) {
        questionStats.set(question.id, {
          questionId: question.id,
          question: question.question,
          topic: question.topic || "Uncategorized",
          attempts: 0,
          correct: 0
        });
      }
      const qStat = questionStats.get(question.id);
      qStat.attempts += 1;
      if (isCorrect) qStat.correct += 1;

      const topicKey = question.topic || "Uncategorized";
      if (!topicStats.has(topicKey)) {
        topicStats.set(topicKey, { topic: topicKey, attempts: 0, correct: 0 });
      }
      const tStat = topicStats.get(topicKey);
      tStat.attempts += 1;
      if (isCorrect) tStat.correct += 1;
    });
  });

  const questionWise = Array.from(questionStats.values()).map((q) => ({
    ...q,
    accuracy: q.attempts > 0 ? Math.round((q.correct / q.attempts) * 100) : 0
  }));

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
const getFinalTestOverview = async (instructorId, { courseId, quizId } = {}) => {
  const courseIds = await resolveCourseIds(instructorId, courseId);
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
