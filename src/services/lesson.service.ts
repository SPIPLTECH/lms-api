import { prisma } from "../config/database";

export const createLesson = async (
  title: string,
  description: string,
  videoUrl: string,
  pdfUrl: string,
  order: number,
  courseId: string
) => {
  return prisma.lesson.create({
    data: {
      title,
      description,
      videoUrl,
      pdfUrl,
      order,
      courseId,
    },
  });
};

export const getLessonsByCourse = async (
  courseId: string
) => {
  return prisma.lesson.findMany({
    where: {
      courseId,
    },
    orderBy: {
      order: "asc",
    },
  });
};