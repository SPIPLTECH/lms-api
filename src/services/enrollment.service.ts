import { prisma } from "../config/database";

export const enrollStudent = async (
  userId: string,
  courseId: string
) => {

  const existingEnrollment =
    await prisma.enrollment.findFirst({
      where: {
        userId,
        courseId,
      },
    });

  if (existingEnrollment) {
    throw new Error("Already enrolled");
  }

  return prisma.enrollment.create({
    data: {
      userId,
      courseId,
    },
  });
};

export const getMyCourses = async (
  userId: string
) => {

  return prisma.enrollment.findMany({
    where: {
      userId,
    },
    include: {
      course: true,
    },
  });
};