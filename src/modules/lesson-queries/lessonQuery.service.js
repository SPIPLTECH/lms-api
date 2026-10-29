const prisma = require("../../config/database");
const ApiError = require("../../utils/ApiError");
const notificationService = require("../notifications/notification.service");

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

// Content, Quiz and Assignment share the canonical hierarchy shapes.
const PARENT_SELECT = {
  lessonId: true,
  courseId: true,
  moduleId: true,
  module: { select: { id: true, courseId: true } },
  lesson: { select: { id: true, moduleId: true, module: { select: { id: true, courseId: true } } } },
  topic: {
    select: {
      id: true,
      lessonId: true,
      lesson: { select: { id: true, moduleId: true, module: { select: { id: true, courseId: true } } } }
    }
  },
  subTopic: {
    select: {
      id: true,
      topic: {
        select: {
          id: true,
          lessonId: true,
          lesson: { select: { id: true, moduleId: true, module: { select: { id: true, courseId: true } } } }
        }
      }
    }
  },
  concept: {
    select: {
      id: true,
      subTopic: {
        select: {
          id: true,
          topic: {
            select: {
              id: true,
              lessonId: true,
              lesson: { select: { id: true, moduleId: true, module: { select: { id: true, courseId: true } } } }
            }
          }
        }
      }
    }
  }
};

const createQuery = async (userId, data) => {
  const student = await prisma.studentProfile.findUnique({
    where: { userId },
    include: { user: { select: { id: true, name: true } } }
  });

  if (!student) {
    throw new ApiError(404, "Student profile not found");
  }

  let courseId = data.courseId || null;
  let moduleId = data.moduleId || null;
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
      target.subTopic?.topic?.lesson?.module?.courseId ||
      target.concept?.subTopic?.topic?.lesson?.module?.courseId ||
      null;

    lessonId =
      target.lessonId ||
      target.topic?.lessonId ||
      target.subTopic?.topic?.lessonId ||
      target.concept?.subTopic?.topic?.lessonId ||
      lessonId;

    moduleId =
      target.moduleId ||
      target.lesson?.moduleId ||
      target.topic?.lesson?.moduleId ||
      target.subTopic?.topic?.lesson?.moduleId ||
      target.concept?.subTopic?.topic?.lesson?.moduleId ||
      moduleId;

    courseId = targetCourseId || courseId;
  }

  let lessonCourseId = null;
  if (lessonId) {
    const lsn = await prisma.lesson.findUnique({
      where: { id: lessonId },
      select: { id: true, moduleId: true, module: { select: { id: true, courseId: true } } }
    });
    if (lsn) {
      moduleId = lsn.moduleId || moduleId;
      lessonCourseId = lsn.module?.courseId || null;
      courseId = courseId || lessonCourseId;
    }
  } else if (moduleId) {
    const mod = await prisma.module.findUnique({
      where: { id: moduleId },
      select: { id: true, courseId: true }
    });
    if (mod) {
      courseId = courseId || mod.courseId;
    }
  }

  if (targetField && targetCourseId && lessonCourseId && targetCourseId !== lessonCourseId) {
    throw new ApiError(400, "That item isn't part of this lesson's course.");
  }

  if (targetField && targetCourseId && data.courseId && targetCourseId !== data.courseId) {
    throw new ApiError(400, "That item isn't part of this course.");
  }

  const finalCourseId = targetCourseId || courseId;
  if (!finalCourseId) {
    throw new ApiError(400, "A course must be specified to ask a question.");
  }

  const enrollment = await prisma.enrollment.findFirst({
    where: { studentId: student.id, courseId: finalCourseId }
  });

  if (!enrollment) {
    throw new ApiError(403, "Forbidden: you must be enrolled in this course to ask a question");
  }

  // Backwards compatibility: if lessonId is still null, look for a lesson in
  // the module or course so legacy tools that group queries by lessonId continue to work.
  if (!lessonId && moduleId) {
    const modLesson = await prisma.lesson.findFirst({
      where: { moduleId },
      orderBy: { order: "asc" },
      select: { id: true }
    });
    if (modLesson) lessonId = modLesson.id;
  }
  if (!lessonId && finalCourseId) {
    const crsLesson = await prisma.lesson.findFirst({
      where: { module: { courseId: finalCourseId } },
      orderBy: { order: "asc" },
      select: { id: true }
    });
    if (crsLesson) lessonId = crsLesson.id;
  }

  const newQuery = await prisma.lessonQuery.create({
    data: {
      courseId: finalCourseId,
      moduleId: moduleId || null,
      lessonId: lessonId || null,
      studentId: student.id,
      question: data.question.trim(),
      contentId: targetField === "contentId" ? data.contentId : null,
      quizId: targetField === "quizId" ? data.quizId : null,
      assignmentId: targetField === "assignmentId" ? data.assignmentId : null
    }
  });

  // Notify the course instructor after successful query creation
  const courseRecord = await prisma.course.findUnique({
    where: { id: finalCourseId },
    select: { id: true, title: true, creatorId: true }
  });

  const instructorUserId = courseRecord?.creatorId;
  if (instructorUserId) {
    const studentName = student?.user?.name || "A student";
    const courseTitle = courseRecord?.title || "Course";
    try {
      await notificationService.createNotification(instructorUserId, {
        title: `New question from ${studentName} in ${courseTitle}`,
        message: data.question.trim(),
        type: "QA",
        eventId: `qa_question_${newQuery.id}`,
        actorId: student?.userId
      });
    } catch (err) {
      console.error("Failed to deliver Q&A question notification:", err.message);
    }
  }

  return newQuery;
};

/** Doubts across every course the instructor owns, filterable for the Q&A page. */
const getQueriesForInstructor = async (instructorId, filters = {}) => {
  const courseWhere = { creatorId: instructorId };
  if (filters.courseId) {
    courseWhere.id = filters.courseId;
  }

  const where = {
    OR: [
      { course: courseWhere },
      { module: { course: courseWhere } },
      { lesson: { module: { course: courseWhere } } }
    ]
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
      content: CONTENT_FOR_QA,
      quiz: { select: { id: true, title: true, quizTag: true, description: true, instructions: true } },
      assignment: { select: { id: true, title: true, description: true } },
      course: { select: { id: true, title: true } },
      module: { select: { id: true, title: true, course: { select: { id: true, title: true } } } },
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

/** A student's own questions across every lesson/module/course they've asked about. */
const getQueriesForStudent = async (userId, filters = {}) => {
  const student = await prisma.studentProfile.findUnique({ where: { userId } });

  if (!student) {
    throw new ApiError(404, "Student profile not found");
  }

  const where = { studentId: student.id };
  if (filters.courseId) {
    where.OR = [
      { courseId: filters.courseId },
      { module: { courseId: filters.courseId } },
      { lesson: { module: { courseId: filters.courseId } } }
    ];
  }
  TARGET_FIELDS.forEach((field) => {
    if (filters[field]) where[field] = filters[field];
  });
  if (filters.lessonId) {
    where.lessonId = filters.lessonId;
  }
  if (filters.moduleId) {
    where.moduleId = filters.moduleId;
  }
  if (filters.courseOnly === true || filters.courseOnly === "true") {
    TARGET_FIELDS.forEach((field) => {
      where[field] = null;
    });
    where.moduleId = null;
    where.lessonId = null;
  } else if (filters.moduleOnly === true || filters.moduleOnly === "true") {
    TARGET_FIELDS.forEach((field) => {
      where[field] = null;
    });
    where.lessonId = null;
  } else if (filters.lessonOnly === true || filters.lessonOnly === "true") {
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
      course: { select: { id: true, title: true } },
      module: { select: { id: true, title: true, course: { select: { id: true, title: true } } } },
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
      student: { select: { userId: true } },
      course: { select: { id: true, title: true, creatorId: true } },
      module: {
        include: {
          course: { select: { id: true, title: true, creatorId: true } }
        }
      },
      lesson: {
        include: {
          module: {
            include: {
              course: { select: { id: true, title: true, creatorId: true } }
            }
          }
        }
      }
    }
  });

  if (!query) {
    throw new ApiError(404, "Query not found");
  }

  return query;
};

const assertInstructorOwnsQuery = (query, user) => {
  if (user.role === "ADMIN") return;

  const creatorId =
    query.course?.creatorId ||
    query.module?.course?.creatorId ||
    query.lesson?.module?.course?.creatorId;
  if (user.role !== "INSTRUCTOR" || !creatorId || creatorId !== user.id) {
    throw new ApiError(403, "Forbidden: you do not own the course behind this query");
  }
};

const replyToQuery = async (queryId, user, reply) => {
  const query = await findQueryWithCourseOwner(queryId);
  assertInstructorOwnsQuery(query, user);

  const updatedQuery = await prisma.lessonQuery.update({
    where: { id: queryId },
    data: { reply: reply.trim(), status: "ANSWERED", answeredAt: new Date() }
  });

  // Notify the original student after successful reply creation
  const studentUserId = query?.student?.userId;
  if (studentUserId) {
    const courseTitle =
      query.course?.title ||
      query.module?.course?.title ||
      query.lesson?.module?.course?.title ||
      "Course";
    try {
      await notificationService.createNotification(studentUserId, {
        title: `Instructor replied to your question in ${courseTitle}`,
        message: reply.trim(),
        type: "QA",
        eventId: `qa_reply_${query.id}`,
        actorId: user.id
      });
    } catch (err) {
      console.error("Failed to deliver Q&A reply notification:", err.message);
    }
  }

  return updatedQuery;
};

module.exports = {
  getQueriesForLesson,
  getQueriesForInstructor,
  getQueriesForStudent,
  createQuery,
  replyToQuery,
};
