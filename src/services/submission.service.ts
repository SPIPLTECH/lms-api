import { prisma } from "../config/database";

export const submitAssignment = async (
  userId: string,
  assignmentId: string,
  content: string
) => {

  return prisma.submission.create({
    data: {
      userId,
      assignmentId,
      content,
    },
  });
};

export const getMySubmissions = async (
  userId: string
) => {

  return prisma.submission.findMany({
    where: {
      userId,
    },
    include: {
      assignment: true,
    },
  });
};