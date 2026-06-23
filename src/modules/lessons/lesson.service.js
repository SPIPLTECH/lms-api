const prisma =
  require("../../config/database");

const getLessons = async (
  moduleId
) => {
  return prisma.lesson.findMany({
    where: {
      moduleId
    },
    orderBy: {
      order: "asc"
    }
  });
};

const getLessonById = async (
  lessonId
) => {
  return prisma.lesson.findUnique({
    where: {
      id: lessonId
    },
    include: {
      contents: {
        orderBy: {
          order: "asc"
        }
      }
    }
  });
};

const createLesson = async (
  data
) => {
  return prisma.lesson.create({
    data
  });
};

const updateLesson = async (
  lessonId,
  data
) => {
  return prisma.lesson.update({
    where: {
      id: lessonId
    },
    data
  });
};

const deleteLesson = async (
  lessonId
) => {
  return prisma.lesson.delete({
    where: {
      id: lessonId
    }
  });
};

const reorderLessons = async (
  lessons
) => {
  return prisma.$transaction(
    lessons.map((lesson) =>
      prisma.lesson.update({
        where: {
          id: lesson.lessonId
        },
        data: {
          order: lesson.order
        }
      })
    )
  );
};

module.exports = {
  getLessons,
  getLessonById,
  createLesson,
  updateLesson,
  deleteLesson,
  reorderLessons
};