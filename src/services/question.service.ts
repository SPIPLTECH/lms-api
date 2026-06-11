import { prisma } from "../config/database";

export const addQuestion = async (
  data: any
) => {

  return prisma.question.create({
    data,
  });
};