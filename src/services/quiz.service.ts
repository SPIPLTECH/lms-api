import { prisma } from "../config/database";

export const createQuiz = async (
  title: string,
  courseId: string
) => {

  return prisma.quiz.create({
    data: {
      title,
      courseId,
    },
  });
};

export const getQuiz = async (
  quizId: string
) => {

  return prisma.quiz.findUnique({
    where: {
      id: quizId,
    },
    include: {
      questions: true,
    },
  });
};