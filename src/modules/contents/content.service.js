const prisma = require("../../config/database");
const { sanitizeContent } = require("../../utils/sanitizer");
const {
  QUIZ_CONTENT_TYPE,
  ASSIGNMENT_CONTENT_TYPE,
  claimContentOrder,
  releaseContentOrder,
  applySequenceOrdering,
  moveSequenceItems,
  mostSpecificParentField,
  resolveSequenceItem,
  swapSequenceItems,
} = require("./contentOrder.util");
const progressService = require("../progress/progress.service");
const {
  PARENT_FIELDS,
  COURSE_ID_INCLUDE,
  resolveCourseId,
} = require("../../utils/helpers/courseBreadcrumb.helper");

/**
 * Content is THE learning-sequence entity. Every item a container holds is a
 * Content row, ordered by Content.order within its one parent:
 *
 *   ordinary content  type VIDEO / PDF / TEXT / HTML / …   quizId = assignmentId = null
 *   a quiz            type QUIZ        quizId set,        assignmentId null
 *   an assignment     type ASSIGNMENT  assignmentId set,  quizId null
 *
 * That invariant is enforced here, in the database (CHECK constraint
 * content_type_link, scripts/content-sequence-2-constraints.sql) and by the
 * unique indexes on quizId / assignmentId (a Quiz or Assignment is wrapped by
 * at most one Content row).
 */

const QUIZ_META_SELECT = {
  id: true,
  title: true,
  quizTag: true,
  passingScore: true,
  timeLimit: true,
  attempts: true,
  isPublished: true,
  dueDate: true,
  _count: { select: { quizQuestions: true } },
};

const ASSIGNMENT_META_SELECT = {
  id: true,
  title: true,
  description: true,
  dueDate: true,
  marks: true,
  isPublished: true,
};

const WITH_LINKS = {
  quiz: { select: QUIZ_META_SELECT },
  assignment: { select: ASSIGNMENT_META_SELECT },
};

// Body columns a student only receives for a step they may open.
const BODY_FIELDS = ["videoUrl", "fileUrl", "htmlContent", "externalUrl", "duration", "data"];

// Every relation path from a Content row up to its owning course's creator,
// covering all six attachment levels.
const OWNED_BY_INSTRUCTOR = (userId) => [
  { course: { creatorId: userId } },
  { module: { course: { creatorId: userId } } },
  { lesson: { module: { course: { creatorId: userId } } } },
  { topic: { lesson: { module: { course: { creatorId: userId } } } } },
  { subTopic: { topic: { lesson: { module: { course: { creatorId: userId } } } } } },
  {
    concept: {
      subTopic: { topic: { lesson: { module: { course: { creatorId: userId } } } } },
    },
  },
];

const httpError = (statusCode, message) => Object.assign(new Error(message), { statusCode });

/** The owning course of a container, from whichever of the six levels it is. */
async function courseIdOfParent(parentField, parentId, client = prisma) {
  if (!parentId) return null;
  const lessonCourse = { module: { select: { courseId: true } } };
  switch (parentField) {
    case "courseId":
      return parentId;
    case "moduleId":
      return (await client.module.findUnique({ where: { id: parentId }, select: { courseId: true } }))?.courseId ?? null;
    case "lessonId":
      return (await client.lesson.findUnique({ where: { id: parentId }, select: lessonCourse }))?.module?.courseId ?? null;
    case "topicId":
      return (
        await client.topic.findUnique({ where: { id: parentId }, select: { lesson: { select: lessonCourse } } })
      )?.lesson?.module?.courseId ?? null;
    case "subTopicId":
      return (
        await client.subTopic.findUnique({
          where: { id: parentId },
          select: { topic: { select: { lesson: { select: lessonCourse } } } },
        })
      )?.topic?.lesson?.module?.courseId ?? null;
    case "conceptId":
      return (
        await client.concept.findUnique({
          where: { id: parentId },
          select: { subTopic: { select: { topic: { select: { lesson: { select: lessonCourse } } } } } },
        })
      )?.subTopic?.topic?.lesson?.module?.courseId ?? null;
    default:
      return null;
  }
}

/** QUIZ needs a quizId, ASSIGNMENT an assignmentId, and nothing else may carry either. */
function validateContentDataInvariants(type, quizId, assignmentId) {
  if (type === QUIZ_CONTENT_TYPE) {
    if (!quizId) throw httpError(400, "Content of type QUIZ must have a valid quizId.");
    if (assignmentId) throw httpError(400, "Content of type QUIZ cannot have an assignmentId.");
  } else if (type === ASSIGNMENT_CONTENT_TYPE) {
    if (!assignmentId) throw httpError(400, "Content of type ASSIGNMENT must have a valid assignmentId.");
    if (quizId) throw httpError(400, "Content of type ASSIGNMENT cannot have a quizId.");
  } else if (quizId || assignmentId) {
    throw httpError(400, `Content of type ${type} cannot have a quizId or assignmentId.`);
  }
}

/**
 * Checks that a Quiz may be placed in the learning sequence of `courseId`:
 * it exists, belongs to that course, is not a standalone kind (a QUALIFYING
 * test, a batch assessment) and is not already wrapped by another row.
 */
async function assertQuizLinkable(quizId, courseId, client, exceptContentId = null) {
  const quiz = await client.quiz.findUnique({
    where: { id: quizId },
    select: { id: true, title: true, courseId: true, quizTag: true, batchId: true, content: { select: { id: true } } },
  });
  if (!quiz) throw httpError(404, "Quiz not found.");
  if (courseId && quiz.courseId !== courseId) throw httpError(400, "The quiz belongs to a different course.");
  if (quiz.quizTag === "QUALIFYING") throw httpError(400, "A qualifying test is not a learning-sequence item.");
  if (quiz.batchId) throw httpError(400, "A batch assessment is not a learning-sequence item.");
  if (quiz.content && quiz.content.id !== exceptContentId) {
    throw httpError(409, "This quiz is already placed in the learning sequence.");
  }
  return quiz;
}

/** Same for an Assignment. */
async function assertAssignmentLinkable(assignmentId, courseId, client, exceptContentId = null) {
  const assignment = await client.assignment.findUnique({
    where: { id: assignmentId },
    include: { ...COURSE_ID_INCLUDE, content: { select: { id: true } } },
  });
  if (!assignment) throw httpError(404, "Assignment not found.");
  if (courseId && resolveCourseId(assignment) !== courseId) {
    throw httpError(400, "The assignment belongs to a different course.");
  }
  if (assignment.content && assignment.content.id !== exceptContentId) {
    throw httpError(409, "This assignment is already placed in the learning sequence.");
  }
  return assignment;
}

const studentProfileIdForUser = async (userId) =>
  (await prisma.studentProfile.findUnique({ where: { userId }, select: { id: true } }))?.id ?? null;

/** Strips the material from every row the student may not open yet. */
async function redactLockedForStudent(rows, userId) {
  if (rows.length === 0) return rows;
  const studentId = await studentProfileIdForUser(userId);
  const courseId = resolveCourseId(rows[0]);
  if (!studentId || !courseId) return rows.map(redact);

  await progressService.assertCourseProgressAccess({ role: "STUDENT", id: userId }, studentId, courseId);
  const { sequence } = await progressService.computeStudentSequence(studentId, courseId);
  const lockedIds = new Set(sequence.steps.filter((step) => step.locked).flatMap((step) => step.contentIds));
  return rows.map((row) => (lockedIds.has(row.id) ? redact(row) : row));
}

function redact(row) {
  const copy = { ...row, locked: true };
  for (const field of BODY_FIELDS) copy[field] = null;
  if (copy.assignment) copy.assignment = { ...copy.assignment, description: null };
  return copy;
}

const stripCourseChain = ({ module, lesson, topic, subTopic, concept, course, ...row }) => row;

const getContents = async (query = {}, role, userId) => {
  const where = {};
  const parentField = PARENT_FIELDS.find((field) => query[field]);

  if (parentField) {
    where[parentField] = query[parentField];
  } else if (role === "INSTRUCTOR") {
    where.OR = OWNED_BY_INSTRUCTOR(userId);
  } else if (role === "STUDENT") {
    // A student lists one parent's items, never the whole table.
    throw httpError(400, "Specify the course, module, lesson, topic, subtopic or concept to list.");
  }

  const rows = await prisma.content.findMany({
    where,
    include: role === "STUDENT" ? { ...WITH_LINKS, ...COURSE_ID_INCLUDE } : WITH_LINKS,
    orderBy: { order: "asc" },
  });

  if (role !== "STUDENT") return rows;
  return (await redactLockedForStudent(rows, userId)).map(stripCourseChain);
};

const getContentById = async (contentId, requestingUser = null) => {
  const content = await prisma.content.findUnique({
    where: { id: contentId },
    include: { ...WITH_LINKS, ...COURSE_ID_INCLUDE },
  });
  if (!content) return null;

  if (requestingUser?.role === "STUDENT") {
    const studentId = await studentProfileIdForUser(requestingUser.id);
    const courseId = resolveCourseId(content);
    if (!studentId) throw httpError(404, "Student profile not found.");
    if (courseId) {
      await progressService.assertCourseProgressAccess(requestingUser, studentId, courseId);
      await progressService.assertContentsAccessible(studentId, courseId, [content.id]);
    }
  }

  return stripCourseChain(content);
};

/**
 * Creates a Content row at its parent's sequence position — appended, or
 * inserted at `order` with every later row moved down one.
 *
 *  - type QUIZ needs `quizId`: an existing, unplaced sequence quiz of the same
 *    course. (A new quiz is created through POST /quizzes, which creates its
 *    Content row itself.)
 *  - type ASSIGNMENT with `assignmentId` places that existing assignment;
 *    without one, the Assignment record is created here from the block
 *    (title, htmlContent as its description) — the lesson composer's
 *    "assignment block" — in the same transaction, so neither can exist
 *    without the other.
 */
const createContent = async (data) => {
  const { parentContentId, ...contentData } = data;

  if (contentData.htmlContent) {
    contentData.htmlContent = sanitizeContent(contentData.htmlContent);
  }

  const parentField = PARENT_FIELDS.find((field) => contentData[field]);
  if (!parentField) {
    throw httpError(400, "Content must be attached to exactly one of course, module, lesson, topic, subtopic, or concept.");
  }
  // Exactly one parent: every other parent field is null.
  for (const field of PARENT_FIELDS) {
    if (field !== parentField) contentData[field] = null;
  }

  const type = contentData.type;
  contentData.quizId = contentData.quizId || null;
  contentData.assignmentId = contentData.assignmentId || null;
  const createsAssignment = type === ASSIGNMENT_CONTENT_TYPE && !contentData.assignmentId;
  if (!createsAssignment) validateContentDataInvariants(type, contentData.quizId, contentData.assignmentId);
  else if (contentData.quizId) throw httpError(400, "Content of type ASSIGNMENT cannot have a quizId.");

  const requestedOrder =
    contentData.order === undefined || contentData.order === null || Number.isNaN(Number(contentData.order))
      ? null
      : Number(contentData.order);
  delete contentData.order;

  return prisma.$transaction(async (tx) => {
    const courseId = await courseIdOfParent(parentField, contentData[parentField], tx);
    if (!courseId) throw httpError(404, "Parent not found.");

    if (type === QUIZ_CONTENT_TYPE) {
      const quiz = await assertQuizLinkable(contentData.quizId, courseId, tx);
      if (!contentData.title) contentData.title = quiz.title;
    } else if (type === ASSIGNMENT_CONTENT_TYPE && contentData.assignmentId) {
      const assignment = await assertAssignmentLinkable(contentData.assignmentId, courseId, tx);
      if (!contentData.title) contentData.title = assignment.title;
    }

    const order = await claimContentOrder(parentField, contentData[parentField], requestedOrder, tx);

    if (createsAssignment) {
      const assignment = await tx.assignment.create({
        data: {
          title: contentData.title || "Assignment",
          description: contentData.htmlContent || null,
          dueDate: null,
          isPublished: true,
          courseId: contentData.courseId,
          moduleId: contentData.moduleId,
          lessonId: contentData.lessonId,
          topicId: contentData.topicId,
          subTopicId: contentData.subTopicId,
          conceptId: contentData.conceptId,
        },
      });
      contentData.assignmentId = assignment.id;
      if (!contentData.title) contentData.title = assignment.title;
    }

    return tx.content.create({ data: { ...contentData, order }, include: WITH_LINKS });
  });
};

/**
 * Updates a Content row.
 *
 *  - `order`: moves the row within its parent's sequence (every other row
 *    keeps its relative order; the sequence stays 1..n).
 *  - type / quizId / assignmentId must end up satisfying the invariant.
 *    Moving a row OFF a quiz/assignment (to another type, or to another
 *    quiz/assignment) detaches the old record: it is kept — attempts and
 *    submissions included — as a standalone record that can be placed again
 *    later. Moving a row ONTO a quiz/assignment needs an existing, unplaced
 *    one of the same course.
 *  - The parent cannot change here.
 */
const updateContent = async (contentId, data) => {
  const existing = await prisma.content.findUnique({ where: { id: contentId } });
  if (!existing) throw httpError(404, "Content not found");

  const { parentContentId, order, ...contentData } = data;
  for (const field of PARENT_FIELDS) delete contentData[field];

  if (contentData.htmlContent) {
    contentData.htmlContent = sanitizeContent(contentData.htmlContent);
  }

  const targetType = contentData.type || existing.type;
  const targetQuizId =
    "quizId" in contentData ? contentData.quizId || null : targetType === QUIZ_CONTENT_TYPE ? existing.quizId : null;
  const targetAssignmentId =
    "assignmentId" in contentData
      ? contentData.assignmentId || null
      : targetType === ASSIGNMENT_CONTENT_TYPE
        ? existing.assignmentId
        : null;

  validateContentDataInvariants(targetType, targetQuizId, targetAssignmentId);

  const parentField = mostSpecificParentField(existing);

  return prisma.$transaction(async (tx) => {
    const courseId = await courseIdOfParent(parentField, existing[parentField], tx);
    if (targetQuizId && targetQuizId !== existing.quizId) await assertQuizLinkable(targetQuizId, courseId, tx, existing.id);
    if (targetAssignmentId && targetAssignmentId !== existing.assignmentId) {
      await assertAssignmentLinkable(targetAssignmentId, courseId, tx, existing.id);
    }

    if (order !== undefined && order !== null && Number(order) !== existing.order) {
      await moveSequenceItems(parentField, existing[parentField], [{ id: existing.id, order: Number(order) }], tx);
    }

    return tx.content.update({
      where: { id: contentId },
      data: { ...contentData, quizId: targetQuizId, assignmentId: targetAssignmentId },
      include: WITH_LINKS,
    });
  });
};

/**
 * Removes a Content row and closes its slot in the sequence. A QUIZ /
 * ASSIGNMENT row is the quiz's/assignment's place in the course, so the
 * record it stands for is removed with it — one transaction, never one
 * without the other.
 */
const deleteContent = async (contentId) => {
  const existing = await prisma.content.findUnique({ where: { id: contentId } });
  if (!existing) throw httpError(404, "Content not found");

  return prisma.$transaction(async (tx) => {
    const deleted = await tx.content.delete({ where: { id: contentId } });
    if (existing.quizId) await tx.quiz.deleteMany({ where: { id: existing.quizId } });
    if (existing.assignmentId) await tx.assignment.deleteMany({ where: { id: existing.assignmentId } });
    await releaseContentOrder(existing, tx);
    return deleted;
  });
};

/**
 * Reorders one parent's learning sequence: its Content rows (ordinary content,
 * quizzes, assignments) and its child containers share it.
 *
 * Two request shapes:
 *   { contents: [{ id, order }, …], parentType?, parentId? }
 *       move these items (Content or child-container ids) to these positions —
 *       a swap, or a full list; every other item keeps its relative order.
 *       Without parentType/parentId the parent is read off the Content rows.
 *   { parentType, parentId, orderedIds: [...] }
 *       the parent's complete new order.
 * Either way the result is a gap-free 1..n sequence with no duplicates, in one
 * transaction under the parent's sequence lock.
 */
const reorderContents = async (payload, requestingUser = null) => {
  const body = Array.isArray(payload) ? { contents: payload } : payload || {};

  let parentField = body.parentType ? `${body.parentType}Id` : null;
  let parentId = body.parentId || null;
  if (parentField && (!PARENT_FIELDS.includes(parentField) || !parentId)) {
    throw httpError(400, "parentType and parentId must name a course, module, lesson, topic, subtopic or concept.");
  }

  if (!Array.isArray(body.orderedIds)) {
    const moves = Array.isArray(body.contents) ? body.contents : [];
    if (moves.length === 0) return [];
    if (!parentField) {
      const rows = await prisma.content.findMany({
        where: { id: { in: moves.map((m) => m.id) } },
        select: { id: true, courseId: true, moduleId: true, lessonId: true, topicId: true, subTopicId: true, conceptId: true },
      });
      if (rows.length === 0) throw httpError(404, "Content not found.");
      const parents = new Set(rows.map((row) => `${mostSpecificParentField(row)}:${row[mostSpecificParentField(row)]}`));
      if (parents.size !== 1) throw httpError(400, "A reorder may only move items of one parent.");
      parentField = mostSpecificParentField(rows[0]);
      parentId = rows[0][parentField];
    }
  } else if (!parentField) {
    throw httpError(400, "parentType and parentId are required.");
  }

  if (requestingUser && requestingUser.role !== "ADMIN") {
    const courseId = await courseIdOfParent(parentField, parentId);
    const course = courseId
      ? await prisma.course.findUnique({ where: { id: courseId }, select: { creatorId: true } })
      : null;
    if (!course) throw httpError(404, "Parent not found.");
    if (course.creatorId !== requestingUser.id) throw httpError(403, "Forbidden: you do not own this course");
  }

  return prisma.$transaction((tx) =>
    Array.isArray(body.orderedIds)
      ? applySequenceOrdering(parentField, parentId, body.orderedIds, tx)
      : moveSequenceItems(parentField, parentId, body.contents, tx)
  );
};

/**
 * Trades the positions of two items of one parent's sequence, of any kind
 * ({ kind, id } — content, quiz, assignment, module, lesson, topic, subTopic,
 * concept). Both items must share a parent (the swap enforces it), so owning
 * the first item's course is owning the second's.
 */
const swapSequenceOrder = async (first, second, requestingUser = null) => {
  if (requestingUser && requestingUser.role !== "ADMIN") {
    const item = await resolveSequenceItem(first);
    const courseId = item ? await courseIdOfParent(item.parentField, item.parentId) : null;
    const course = courseId
      ? await prisma.course.findUnique({ where: { id: courseId }, select: { creatorId: true } })
      : null;
    if (!course) throw httpError(404, "Item not found in a learning sequence.");
    if (course.creatorId !== requestingUser.id) {
      throw httpError(403, "You do not have permission to reorder this item.");
    }
  }
  return swapSequenceItems(first, second);
};

module.exports = {
  getContents,
  getContentById,
  createContent,
  updateContent,
  deleteContent,
  reorderContents,
  swapSequenceOrder,
  validateContentDataInvariants,
  courseIdOfParent,
};
