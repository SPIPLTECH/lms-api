const prisma = require("../../config/database");
const { evaluateAnswer } = require("../quizzes/quiz.service");

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

const getResults = async (instructorId, filters = {}) => {
  const { courseId, batchId, quizId, assignmentId, studentId, startDate, endDate } = filters;

  const courseIds = await resolveCourseIds(instructorId, courseId);
  const batchStudentIds = await resolveBatchStudentIds(batchId);

  if (courseIds.length === 0 || batchStudentIds?.length === 0) {
    return emptyResult();
  }

  const submittedAtRange = dateRangeWhere(startDate, endDate);

  const quizWhere = {
    courseId: { in: courseIds },
    ...(quizId ? { id: quizId } : {})
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
          quizQuestions: {
            select: {
              question: {
                select: { id: true, question: true, topic: true, correctAnswer: true, questionType: true }
              }
            }
          }
        }
      },
      student: { include: { user: { select: { id: true, name: true } } } }
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
    quizId: s.quiz?.id,
    title: s.quiz?.title,
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
  getResults
};
