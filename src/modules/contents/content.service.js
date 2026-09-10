const prisma = require("../../config/database");
const { sanitizeContent } = require("../../utils/sanitizer");
const { getNextOrder } = require("./contentOrder.util");
const progressService = require("../progress/progress.service");

const PARENT_FIELDS = ["courseId", "moduleId", "lessonId", "topicId"];

const getContents = async (query = {}, role, userId) => {
  const where = {};
  const parentField = PARENT_FIELDS.find((field) => query[field]);

  if (parentField) {
    where[parentField] = query[parentField];
  } else if (role === "INSTRUCTOR") {
    where.OR = [
      { course: { creatorId: userId } },
      { module: { course: { creatorId: userId } } },
      { lesson: { module: { course: { creatorId: userId } } } },
      { topic: { lesson: { module: { course: { creatorId: userId } } } } },
    ];
  }

  return prisma.content.findMany({
    where,
    orderBy: {
      order: "asc"
    }
  });
};

const getContentById = async (contentId) => {
  return prisma.content.findUnique({
    where: {
      id: contentId
    }
  });
};

const createContent = async (data) => {
  const { parentContentId, ...contentData } = data;

  if (contentData.htmlContent) {
    contentData.htmlContent = sanitizeContent(contentData.htmlContent);
  }

  const parentField = PARENT_FIELDS.find((field) => contentData[field]);

  // Auto-calculate order if missing or not an integer
  if (contentData.order === undefined || contentData.order === null || isNaN(Number(contentData.order))) {
    contentData.order = parentField
      ? await getNextOrder(parentField, contentData[parentField])
      : 1;
  } else {
    contentData.order = Number(contentData.order);
  }

  return prisma.content.create({
    data: contentData
  });
};

const updateContent = async (contentId, data) => {
  const existing = await prisma.content.findUnique({ where: { id: contentId } });
  if (!existing) {
    const error = new Error("Content not found");
    error.statusCode = 404;
    throw error;
  }

  const { lessonId, parentContentId, ...contentData } = data;

  if (contentData.htmlContent) {
    contentData.htmlContent = sanitizeContent(contentData.htmlContent);
  }
  if (contentData.order !== undefined && contentData.order !== null) {
    contentData.order = Number(contentData.order);
  }
  return prisma.content.update({
    where: {
      id: contentId
    },
    data: contentData
  });
};

const deleteContent = async (contentId) => {
  const existing = await prisma.content.findUnique({ where: { id: contentId } });
  if (!existing) {
    const error = new Error("Content not found");
    error.statusCode = 404;
    throw error;
  }

  return prisma.content.delete({
    where: {
      id: contentId
    }
  });
};

const reorderContents = async (
  contents
) => {
  // Two-phase reorder: @@unique([lessonId, order]) rejects a naive
  // parallel swap (A->2 while B still holds 2), so first move every
  // row to a disjoint negative placeholder, then to its final order.
  const offsetUpdates = contents.map((content, index) =>
    prisma.content.update({
      where: {
        id: content.id
      },
      data: {
        order: -1000 - index
      }
    })
  );

  const finalUpdates = contents.map((content) =>
    prisma.content.update({
      where: {
        id: content.id
      },
      data: {
        order: content.order
      }
    })
  );

  return prisma.$transaction(
    [...offsetUpdates, ...finalUpdates]
  );
};

const toSubmissionDto = (submission) =>
  submission
    ? {
        status: submission.status,
        fileUrl: submission.fileUrl,
        fileName: submission.fileName,
        fileSize: submission.fileSize,
        fileType: submission.fileType,
        submittedAt: submission.submittedAt,
        grade: submission.grade,
        feedback: submission.feedback,
        textAnswer: submission.textAnswer,
      }
    : null;

/**
 * Loads a Content row a student is about to submit against, and rejects it
 * unless it is an ASSIGNMENT block in a course the student is enrolled in.
 */
const loadAssignmentContentForStudent = async (contentId, studentId, requestingUser) => {
  const content = await prisma.content.findUnique({
    where: { id: contentId },
    include: {
      topic: { include: { lesson: { include: { module: true } } } },
      lesson: { include: { module: true } },
      module: true,
    },
  });

  if (!content) {
    const error = new Error("Content not found");
    error.statusCode = 404;
    throw error;
  }

  if (content.type !== "ASSIGNMENT") {
    const error = new Error("Only assignment content accepts submissions.");
    error.statusCode = 400;
    throw error;
  }

  const courseId =
    content.topic?.lesson?.module?.courseId ||
    content.lesson?.module?.courseId ||
    content.module?.courseId ||
    content.courseId;

  if (courseId) {
    await progressService.assertCourseProgressAccess(requestingUser, studentId, courseId);
  }

  return content;
};

/** The student's own submission for one ASSIGNMENT content block, or null. */
const getMyContentSubmission = async (contentId, studentId, requestingUser) => {
  await loadAssignmentContentForStudent(contentId, studentId, requestingUser);

  const submission = await prisma.contentSubmission.findUnique({
    where: { studentId_contentId: { studentId, contentId } },
  });
  return toSubmissionDto(submission);
};

/**
 * Records the student's uploaded PDF for an ASSIGNMENT content block, then
 * marks that block complete through the normal progress roll-up. One
 * submission per student per block — resubmitting replaces the stored PDF.
 */
const submitContentAssignment = async (contentId, studentId, data, requestingUser) => {
  await loadAssignmentContentForStudent(contentId, studentId, requestingUser);

  // A PDF, a written answer, or both. Resubmitting replaces the whole
  // submission, so fields left out here are cleared, not kept.
  const fileFields = {
    fileUrl: data.fileUrl || null,
    fileName: data.fileUrl ? data.fileName : null,
    fileSize: data.fileUrl ? data.fileSize ?? null : null,
    fileType: data.fileUrl ? data.fileType || null : null,
    textAnswer: data.textAnswer?.trim() || null,
  };

  if (!fileFields.fileUrl && !fileFields.textAnswer) {
    const error = new Error("Upload a PDF or write an answer to submit.");
    error.statusCode = 400;
    throw error;
  }

  const submission = await prisma.contentSubmission.upsert({
    where: { studentId_contentId: { studentId, contentId } },
    // A resubmission replaces the graded PDF, so any old grade is cleared.
    update: { status: "Submitted", submittedAt: new Date(), grade: null, feedback: null, ...fileFields },
    create: { studentId, contentId, status: "Submitted", ...fileFields },
  });

  // Access was verified above, so no requestingUser is passed again.
  await progressService.completeContent(studentId, contentId, true);

  return toSubmissionDto(submission);
};

const COURSE_SUMMARY = { select: { id: true, title: true } };

/**
 * Every lesson-composer Assignment block (Content type ASSIGNMENT) in the
 * instructor's own courses — all of them for ADMIN — with how many student
 * submissions are still ungraded.
 */
const getInstructorAssignmentContents = async (userId, role) => {
  const where = { type: "ASSIGNMENT" };
  if (role !== "ADMIN") {
    where.OR = [
      { course: { creatorId: userId } },
      { module: { course: { creatorId: userId } } },
      { lesson: { module: { course: { creatorId: userId } } } },
      { topic: { lesson: { module: { course: { creatorId: userId } } } } },
    ];
  }

  const contents = await prisma.content.findMany({
    where,
    include: {
      course: COURSE_SUMMARY,
      module: { select: { course: COURSE_SUMMARY } },
      lesson: { select: { title: true, module: { select: { course: COURSE_SUMMARY } } } },
      topic: {
        select: {
          title: true,
          lesson: { select: { title: true, module: { select: { course: COURSE_SUMMARY } } } },
        },
      },
      _count: { select: { submissions: { where: { grade: null } } } },
      // The newest few submissions, so a "recent submissions" feed has a
      // student and a timestamp — same cap as getInstructorAssignments.
      submissions: {
        orderBy: { submittedAt: "desc" },
        take: 5,
        include: { student: { select: { user: { select: { name: true } } } } },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return contents.map((c) => ({
    id: c.id,
    title: c.title,
    description: c.htmlContent,
    course:
      c.course ||
      c.module?.course ||
      c.lesson?.module?.course ||
      c.topic?.lesson?.module?.course ||
      null,
    lessonTitle: c.lesson?.title || c.topic?.lesson?.title || null,
    topicTitle: c.topic?.title || null,
    pendingSubmissionsCount: c._count.submissions,
    submissions: (c.submissions || []).map((s) => ({
      id: s.id,
      studentName: s.student?.user?.name || "Student",
      status: s.status,
      grade: s.grade,
      submittedAt: s.submittedAt,
    })),
    createdAt: c.createdAt,
  }));
};

/**
 * Every student submission for one ASSIGNMENT content block, for the owning
 * instructor. Route-level verifyContentOwnership has already run. Same shape
 * as GET /assignments/:id/submissions so the same panel renders both.
 */
const getContentSubmissions = async (contentId) => {
  const content = await prisma.content.findUnique({
    where: { id: contentId },
    select: { id: true, title: true, type: true },
  });

  if (!content || content.type !== "ASSIGNMENT") {
    const error = new Error("Assignment content not found.");
    error.statusCode = 404;
    throw error;
  }

  const submissions = await prisma.contentSubmission.findMany({
    where: { contentId },
    orderBy: { submittedAt: "desc" },
    include: {
      student: {
        select: { id: true, user: { select: { id: true, name: true, email: true } } },
      },
    },
  });

  return {
    content: { id: content.id, title: content.title },
    submissions: submissions.map((s) => ({
      id: s.id,
      studentId: s.studentId,
      studentName: s.student?.user?.name || "Student",
      studentEmail: s.student?.user?.email || "",
      status: s.status,
      grade: s.grade,
      feedback: s.feedback,
      submittedAt: s.submittedAt,
      fileUrl: s.fileUrl,
      fileName: s.fileName,
      fileSize: s.fileSize,
      fileType: s.fileType,
      textAnswer: s.textAnswer,
    })),
  };
};

/**
 * Instructor grades one student submission for an ASSIGNMENT content block.
 * Route-level verifyContentOwnership has already run; the submission must
 * belong to this content block, so a submissionId from elsewhere is a 404.
 */
const gradeContentSubmission = async (contentId, submissionId, { grade, feedback }) => {
  const existing = await prisma.contentSubmission.findFirst({
    where: { id: submissionId, contentId },
    select: { id: true },
  });

  if (!existing) {
    const error = new Error("Submission not found.");
    error.statusCode = 404;
    throw error;
  }

  const updated = await prisma.contentSubmission.update({
    where: { id: submissionId },
    data: { grade, feedback: feedback || null, status: "Graded" },
  });

  return {
    id: updated.id,
    status: updated.status,
    grade: updated.grade,
    feedback: updated.feedback,
  };
};

module.exports = {
  getContents,
  getContentById,
  createContent,
  updateContent,
  deleteContent,
  reorderContents,
  getMyContentSubmission,
  submitContentAssignment,
  getInstructorAssignmentContents,
  getContentSubmissions,
  gradeContentSubmission
};