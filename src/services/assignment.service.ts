import { prisma } from "../config/database";

export const createAssignment = async (
  title: string,
  description: string,
  courseId: string
) => {
  return prisma.assignment.create({
    data: {
      title,
      description,
      courseId,
    },
  });
};

export const getAssignments = async (
  courseId: string
) => {
  return prisma.assignment.findMany({
    where: {
      courseId,
    },
  });
};