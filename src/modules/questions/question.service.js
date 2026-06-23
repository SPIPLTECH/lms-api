const prisma = require("../../config/database");

const getQuestions = async (
  quizId
) => {
  const where = {};

  if (quizId) {
    where.quizId = quizId;
  }

  return prisma.question.findMany({
    where
  });
};

const getQuestionById = async (
  questionId
) => {
  return prisma.question.findUnique({
    where: {
      id: questionId
    }
  });
};

const createQuestion = async (
  data
) => {
  return prisma.question.create({
    data
  });
};

const updateQuestion = async (
  questionId,
  data
) => {
  return prisma.question.update({
    where: {
      id: questionId
    },
    data
  });
};

const deleteQuestion = async (
  questionId
) => {
  return prisma.question.delete({
    where: {
      id: questionId
    }
  });
};

module.exports = {
  getQuestions,
  getQuestionById,
  createQuestion,
  updateQuestion,
  deleteQuestion
};