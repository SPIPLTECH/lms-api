import { prisma } from "../config/database";

export const createCourse = async (
  title: string,
  description: string,
  price: number,
  teacherId: string
) => {

  return prisma.course.create({
    data: {
      title,
      description,
      price,
      teacherId,
    },
  });
};

export const getCourses = async () => {
  return prisma.course.findMany({
    include: {
      teacher: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
  });
};