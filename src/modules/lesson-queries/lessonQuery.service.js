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

/** Doubts across every course the instructor owns, filterable for the Q&A page. */
const getQueriesForInstructor = async (instructorId, filters = {}) => {
  const courseWhere = { creatorId: instructorId };
  if (filters.courseId) {
    courseWhere.id = filters.courseId;
  }

  const where = {
    lesson: { module: { course: courseWhere } }
  };

  if (filters.status) {
    where.status = filters.status;
  }
  if (filters.startDate || filters.endDate) {
    where.createdAt = {};
    if (filters.startDate) where.createdAt.gte = new Date(filters.startDate);
    if (filters.endDate) where.createdAt.lte = new Date(filters.endDate);
  }

  return prisma.lessonQuery.findMany({
    where,
    include: {
      student: {
        include: { user: { select: { id: true, name: true } } }
      },
      lesson: {
        select: {
          id: true,
          title: true,
          module: {
            select: {
              id: true,
              title: true,
              course: { select: { id: true, title: true } }
            }
          }
        }
      }
    },
    orderBy: { createdAt: "desc" }
  });
};

/** A student's own questions across every lesson they've asked about. */
const getQueriesForStudent = async (userId, filters = {}) => {
  const student = await prisma.studentProfile.findUnique({ where: { userId } });

  if (!student) {
    throw new ApiError(404, "Student profile not found");
  }

  const where = { studentId: student.id };
  if (filters.courseId) {
    where.lesson = { module: { courseId: filters.courseId } };
  }

  return prisma.lessonQuery.findMany({
    where,
    include: {
      lesson: {
        select: {
          id: true,
          title: true,
          module: {
            select: {
              id: true,
              title: true,
              course: { select: { id: true, title: true } }
            }
          }
        }
      }
    },
    orderBy: { createdAt: "desc" }
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
  getQueriesForInstructor,
  getQueriesForStudent,
  createQuery,
  replyToQuery,
  updateStatus
};
