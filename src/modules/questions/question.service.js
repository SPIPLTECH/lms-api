const prisma = require("../../config/database");

const getQuestions = async (
  quizId
) => {
  const where = {};

  if (quizId) {
    where.quizId = quizId;
  }

  return prisma.question.findMany({
    where,
    orderBy: {
      createdAt: "asc"
    }
  });
};

const getQuestionsByQuizId = async (quizId) => {
  return prisma.question.findMany({
    where: {
      quizId,
    },
    select: {
      id: true,
      quizId: true,
      question: true,
      options: true,
      marks: true,
      createdAt: true,
    },
    orderBy: {
      createdAt: "asc",
    },
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
  getQuestionsByQuizId,
  getQuestionById,
  createQuestion,
  updateQuestion,
  deleteQuestion
};