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

// What the instructor needs to see the content a question was asked about.
const CONTENT_FOR_QA = {
  select: {
    id: true,
    title: true,
    type: true,
    htmlContent: true,
    videoUrl: true,
    fileUrl: true,
    externalUrl: true
  }
};

// The items a question can be asked from, and the Prisma model behind each.
const TARGETS = {
  contentId: { model: "content", label: "Content" },
  quizId: { model: "quiz", label: "Quiz" },
  assignmentId: { model: "assignment", label: "Assignment" }
};
const TARGET_FIELDS = Object.keys(TARGETS);

// Content, Quiz and Assignment share the same four-level parent shape, so
// one select finds the lesson and course behind any of them.
const PARENT_SELECT = {
  lessonId: true,
  courseId: true,
  module: { select: { courseId: true } },
  lesson: { select: { module: { select: { courseId: true } } } },
  topic: { select: { lessonId: true, lesson: { select: { module: { select: { courseId: true } } } } } }
};

const createQuery = async (userId, data) => {
  const student = await prisma.studentProfile.findUnique({ where: { userId } });

  if (!student) {
    throw new ApiError(404, "Student profile not found");
  }

  let lessonId = data.lessonId || null;
  const targetField = TARGET_FIELDS.find((field) => data[field]) || null;
  let targetCourseId = null;

  if (targetField) {
    const { model, label } = TARGETS[targetField];
    const target = await prisma[model].findUnique({
      where: { id: data[targetField] },
      select: { id: true, ...PARENT_SELECT }
    });

    if (!target) {
      throw new ApiError(404, `${label} not found`);
    }

    targetCourseId =
      target.courseId ||
      target.module?.courseId ||
      target.lesson?.module?.courseId ||
      target.topic?.lesson?.module?.courseId ||
      null;
    // An item inside a lesson (directly or via a topic) is filed under that
    // lesson; a course/module-level item falls back to the lesson sent.
    lessonId = target.lessonId || target.topic?.lessonId || lessonId;
  }

  if (!lessonId) {
    throw new ApiError(400, "Ask your question from inside a lesson.");
  }

  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
    select: { id: true, module: { select: { courseId: true } } }
  });

  if (!lesson) {
    throw new ApiError(404, "Lesson not found");
  }

  if (targetField && targetCourseId && targetCourseId !== lesson.module.courseId) {
    throw new ApiError(400, "That item isn't part of this lesson's course.");
  }

  const enrollment = await prisma.enrollment.findFirst({
    where: { studentId: student.id, courseId: lesson.module.courseId }
  });

  if (!enrollment) {
    throw new ApiError(403, "Forbidden: you must be enrolled in this course to ask a question");
  }

  return prisma.lessonQuery.create({
    data: {
      lessonId,
      studentId: student.id,
      question: data.question.trim(),
      // Exactly the one item asked from; the others stay null.
      contentId: targetField === "contentId" ? data.contentId : null,
      quizId: targetField === "quizId" ? data.quizId : null,
      assignmentId: targetField === "assignmentId" ? data.assignmentId : null
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
      // The item the question was asked about, so the instructor can
      // read it right where they answer.
      content: CONTENT_FOR_QA,
      quiz: { select: { id: true, title: true, quizTag: true, description: true, instructions: true } },
      assignment: { select: { id: true, title: true, description: true } },
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
  // Narrow to one item (the Ask Instructor popover) and/or one lesson.
  TARGET_FIELDS.forEach((field) => {
    if (filters[field]) where[field] = filters[field];
  });
  if (filters.lessonId) {
    where.lessonId = filters.lessonId;
  }
  // Lesson-wide view: only questions not tied to any one item, so a question
  // asked about a specific item is never listed anywhere but on that item.
  if (filters.lessonOnly === true || filters.lessonOnly === "true") {
    TARGET_FIELDS.forEach((field) => {
      where[field] = null;
    });
  }

  return prisma.lessonQuery.findMany({
    where,
    include: {
      content: { select: { id: true, title: true, type: true } },
      quiz: { select: { id: true, title: true } },
      assignment: { select: { id: true, title: true } },
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
