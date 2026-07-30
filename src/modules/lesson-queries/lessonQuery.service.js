const prisma = require("../../config/database");
const ApiError = require("../../utils/ApiError");

const getQueriesForLesson = async (lessonId) => {
  return prisma.lessonQuery.findMany({
    where: { lessonId },
    include: {
      student: {
        include: { user: { select: { id: true, name: true } } }
      }
    },
    orderBy: { createdAt: "desc" }
  });
};

const createQuery = async (userId, data) => {
  const student = await prisma.studentProfile.findUnique({ where: { userId } });

  if (!student) {
    throw new ApiError(404, "Student profile not found");
  }

  const lesson = await prisma.lesson.findUnique({
    where: { id: data.lessonId },
    select: { id: true, module: { select: { courseId: true } } }
  });

  if (!lesson) {
    throw new ApiError(404, "Lesson not found");
  }

  const enrollment = await prisma.enrollment.findFirst({
    where: { studentId: student.id, courseId: lesson.module.courseId }
  });

  if (!enrollment) {
    throw new ApiError(403, "Forbidden: you must be enrolled in this course to ask a question");
  }

  return prisma.lessonQuery.create({
    data: {
      lessonId: data.lessonId,
      studentId: student.id,
      question: data.question
    }
  });
};

/** Loads a query plus enough of the relation chain to verify course ownership. */
const findQueryWithCourseOwner = async (queryId) => {
  const query = await prisma.lessonQuery.findUnique({
    where: { id: queryId },
    include: {
      lesson: { include: { module: { include: { course: { select: { creatorId: true } } } } } }
    }
  });

  if (!query) {
    throw new ApiError(404, "Query not found");
  }

  return query;
};

const assertInstructorOwnsQuery = (query, user) => {
  if (user.role === "ADMIN") return;

  const creatorId = query.lesson?.module?.course?.creatorId;
  if (user.role !== "INSTRUCTOR" || !creatorId || creatorId !== user.id) {
    throw new ApiError(403, "Forbidden: you do not own the course behind this query");
  }
};

const replyToQuery = async (queryId, user, reply) => {
  const query = await findQueryWithCourseOwner(queryId);
  assertInstructorOwnsQuery(query, user);

  return prisma.lessonQuery.update({
    where: { id: queryId },
    data: { reply, status: "ANSWERED", answeredAt: new Date() }
  });
};

const updateStatus = async (queryId, user, status) => {
  const query = await findQueryWithCourseOwner(queryId);
  assertInstructorOwnsQuery(query, user);

  return prisma.lessonQuery.update({
    where: { id: queryId },
    data: {
      status,
      answeredAt: status === "ANSWERED" ? new Date() : null
    }
  });
};

module.exports = {
  getQueriesForLesson,
  createQuery,
  replyToQuery,
  updateStatus
};
