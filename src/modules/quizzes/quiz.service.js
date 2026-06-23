const prisma = require("../../config/database");

const getQuizzes = async (
  courseId
) => {
  const where = {};

  if (courseId) {
    where.courseId = courseId;
  }

  return prisma.quiz.findMany({
    where
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

module.exports = {
  getQuizzes,
  getQuizById,
  createQuiz,
  updateQuiz,
  deleteQuiz
};