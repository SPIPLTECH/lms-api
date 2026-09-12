const prisma = require("../../config/database");
const ApiError = require("../../utils/ApiError");

const AUTHOR_SELECT = { select: { id: true, name: true, role: true } };

/**
 * Verifies the caller may see/post in this course's discussions: ADMIN
 * always; INSTRUCTOR only if they own the course; STUDENT only if enrolled.
 * Never trust courseId alone — every access is checked against real
 * ownership/enrollment rows.
 */
const assertCourseAccess = async (courseId, user) => {
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: { id: true, creatorId: true }
  });

  if (!course) {
    throw new ApiError(404, "Course not found");
  }

  if (user.role === "ADMIN") {
    return course;
  }

  if (user.role === "INSTRUCTOR") {
    if (course.creatorId !== user.id) {
      throw new ApiError(403, "Forbidden: you do not own this course");
    }
    return course;
  }

  if (user.role === "STUDENT") {
    const student = await prisma.studentProfile.findUnique({ where: { userId: user.id } });
    if (!student) {
      throw new ApiError(403, "Forbidden");
    }

    const enrollment = await prisma.enrollment.findFirst({
      where: { studentId: student.id, courseId }
    });

    if (!enrollment) {
      throw new ApiError(403, "Forbidden: you must be enrolled in this course");
    }

    return course;
  }

  throw new ApiError(403, "Forbidden");
};

const getDiscussionsForCourse = async (courseId, user) => {
  await assertCourseAccess(courseId, user);

  return prisma.discussion.findMany({
    where: { courseId },
    include: {
      author: AUTHOR_SELECT,
      replies: {
        include: { author: AUTHOR_SELECT },
        orderBy: { createdAt: "asc" }
      }
    },
    orderBy: [{ isPinned: "desc" }, { createdAt: "desc" }]
  });
};

const createDiscussion = async (courseId, user, data) => {
  await assertCourseAccess(courseId, user);

  return prisma.discussion.create({
    data: { courseId, authorId: user.id, title: data.title, body: data.body },
    include: { author: AUTHOR_SELECT }
  });
};

const findDiscussionWithCourse = async (discussionId) => {
  const discussion = await prisma.discussion.findUnique({
    where: { id: discussionId },
    include: { course: { select: { id: true, creatorId: true } } }
  });

  if (!discussion) {
    throw new ApiError(404, "Discussion not found");
  }

  return discussion;
};

const replyToDiscussion = async (discussionId, user, body) => {
  const discussion = await findDiscussionWithCourse(discussionId);
  await assertCourseAccess(discussion.courseId, user);

  const isAdmin = user.role === "ADMIN";
  const isOwningInstructor = user.role === "INSTRUCTOR" && discussion.course.creatorId === user.id;

  if (discussion.isLocked && !isAdmin && !isOwningInstructor) {
    throw new ApiError(403, "Forbidden: this discussion is locked");
  }

  return prisma.discussionReply.create({
    data: { discussionId, authorId: user.id, body },
    include: { author: AUTHOR_SELECT }
  });
};

const updateDiscussion = async (discussionId, user, data) => {
  const discussion = await findDiscussionWithCourse(discussionId);
  const isAdmin = user.role === "ADMIN";
  const isOwningInstructor = user.role === "INSTRUCTOR" && discussion.course.creatorId === user.id;

  if (!isAdmin && !isOwningInstructor) {
    throw new ApiError(403, "Forbidden: only the course instructor can pin or lock a discussion");
  }

  return prisma.discussion.update({
    where: { id: discussionId },
    data: {
      ...(data.isPinned !== undefined ? { isPinned: data.isPinned } : {}),
      ...(data.isLocked !== undefined ? { isLocked: data.isLocked } : {})
    }
  });
};

const deleteDiscussion = async (discussionId, user) => {
  const discussion = await findDiscussionWithCourse(discussionId);
  const isAdmin = user.role === "ADMIN";
  const isOwningInstructor = user.role === "INSTRUCTOR" && discussion.course.creatorId === user.id;
  const isAuthor = discussion.authorId === user.id;

  if (!isAdmin && !isOwningInstructor && !isAuthor) {
    throw new ApiError(403, "Forbidden: you cannot delete this discussion");
  }

  return prisma.discussion.delete({ where: { id: discussionId } });
};

const deleteReply = async (replyId, user) => {
  const reply = await prisma.discussionReply.findUnique({
    where: { id: replyId },
    include: { discussion: { include: { course: { select: { creatorId: true } } } } }
  });

  if (!reply) {
    throw new ApiError(404, "Reply not found");
  }

  const isAdmin = user.role === "ADMIN";
  const isOwningInstructor = user.role === "INSTRUCTOR" && reply.discussion.course.creatorId === user.id;
  const isAuthor = reply.authorId === user.id;

  if (!isAdmin && !isOwningInstructor && !isAuthor) {
    throw new ApiError(403, "Forbidden: you cannot delete this reply");
  }

  return prisma.discussionReply.delete({ where: { id: replyId } });
};

module.exports = {
  getDiscussionsForCourse,
  createDiscussion,
  replyToDiscussion,
  updateDiscussion,
  deleteDiscussion,
  deleteReply
};
