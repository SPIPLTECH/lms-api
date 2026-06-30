const prisma = require("../../config/database");

const calculateSubmissionResult = (quiz, answers = []) => {
  const totalMarks = quiz.questions.reduce((sum, question) => sum + (question.marks || 1), 0);
  const answerMap = new Map(answers.map((answer) => [answer.questionId, answer.selectedOption]));

  let score = 0;

  quiz.questions.forEach((question) => {
    const selectedOption = answerMap.get(question.id);

    if (selectedOption === question.correctAnswer) {
      score += question.marks || 1;
    }
  });

  const percentage = totalMarks === 0 ? 0 : Math.round((score / totalMarks) * 100);

  return {
    score,
    totalMarks,
    percentage,
    passed: percentage >= quiz.passingScore
  };
};

const getQuizzes = async (
  courseId
) => {
  const where = {};

  if (courseId) {
    where.courseId = courseId;
  }

  return prisma.quiz.findMany({
    where,
    include: {
      _count: {
        select: {
          questions: true
        }
      }
    }
  });
};

const getQuizById = async (
  quizId
) => {
  return prisma.quiz.findUnique({
    where: {
      id: quizId
    },
    include: {
      questions: true
    }
  });
};

const createQuiz = async (
  data
) => {
  return prisma.quiz.create({
    data
  });
};

const updateQuiz = async (
  quizId,
  data
) => {
  return prisma.quiz.update({
    where: {
      id: quizId
    },
    data
  });
};

const deleteQuiz = async (
  quizId
) => {
  return prisma.quiz.delete({
    where: {
      id: quizId
    }
  });
};

const submitQuiz = async (studentId, quizId, answers = []) => {
  const quiz = await prisma.quiz.findUnique({
    where: { id: quizId },
    include: { questions: true }
  });

  if (!quiz) {
    const error = new Error("Quiz not found");
    error.statusCode = 404;
    throw error;
  }

  const result = calculateSubmissionResult(quiz, answers);

  return prisma.quizSubmission.upsert({
    where: {
      studentId_quizId: {
        studentId,
        quizId
      }
    },
    update: {
      answers,
      score: result.score,
      totalMarks: result.totalMarks,
      percentage: result.percentage,
      passed: result.passed,
      submittedAt: new Date()
    },
    create: {
      studentId,
      quizId,
      answers,
      score: result.score,
      totalMarks: result.totalMarks,
      percentage: result.percentage,
      passed: result.passed
    }
  });
};

module.exports = {
  calculateSubmissionResult,
  getQuizzes,
  getQuizById,
  createQuiz,
  updateQuiz,
  deleteQuiz,
  submitQuiz
};