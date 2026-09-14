const prisma = require('../../config/database');
const { recomputeCourseProgress, ensureProgressInitialized } = require('../../utils/progressRollup');

/**
 * Upserts ContentProgress rows for `contentIds` to `completed`, preserving
 * `completedAt` from any row already in that state and skipping any id
 * that's already there -- a duplicate/redundant completion call (double
 * click, a replayed video-end event, reopening already-finished content)
 * must not issue a database write at all, per the "no unnecessary writes,
 * no unnecessary timestamp churn" requirement this shares with visits below.
 *
 * `existingRows` must already be the caller's own `contentProgress.findMany`
 * result for exactly these ids/this student -- both completeContent and
 * completeLesson fetch it themselves, in parallel with their other lookup,
 * so this helper never has to make that read itself.
 */
async function upsertContentCompletions(studentId, contentIds, completed, existingRows) {
  const existingByContentId = new Map(existingRows.map((row) => [row.contentId, row]));
  const now = new Date();

  const writes = [];
  for (const id of contentIds) {
    const existing = existingByContentId.get(id);
    if (existing && existing.completed === completed) continue; // already correct -- no write

    const completedAt = completed ? (existing?.completed && existing?.completedAt ? existing.completedAt : now) : null;
    writes.push(
      prisma.contentProgress.upsert({
        where: { studentId_contentId: { studentId, contentId: id } },
        create: { studentId, contentId: id, completed, completedAt: completed ? now : null },
        update: { completed, completedAt }
      })
    );
  }
  if (writes.length > 0) await Promise.all(writes);
}

/**
 * Upserts `visited` on one progress row only when it actually changes the
 * value -- revisiting already-visited content, or a container the student
 * already opened, must never touch the database or shift `visitedAt` off
 * the FIRST visit. Returns `{ changed }` so the caller can skip the
 * (comparatively expensive) course rollup entirely on a true no-op.
 */
async function upsertVisitedIfNeeded(delegate, where, createBase, visited) {
  const existing = await delegate.findUnique({ where, select: { visited: true } });
  if (existing && existing.visited === visited) {
    return { changed: false };
  }
  const now = new Date();
  await delegate.upsert({
    where,
    create: { ...createBase, visited, visitedAt: visited ? now : null },
    update: { visited, visitedAt: visited ? now : null }
  });
  return { changed: true };
}

/**
 * Reshapes a `recomputeCourseProgress(..., { includeTree: true })` result
 * into the flat, course-scoped projections the Student frontend consumes
 * (see getStudentCourseProgress). Shared with completeContent/completeLesson
 * so a mutation response carries the exact same shape a fresh GET would --
 * the frontend can drop it straight into its cache instead of firing a
 * second network request just to re-derive what this call already computed.
 */
function attachFlatProjections(rollup) {
  const { hierarchy } = rollup;

  const completedContentIds = [];
  const completedQuizIds = [];
  const completedAssignmentIds = [];
  const completedTopicIds = [];
  const completedLessonIds = [];
  const completedModuleIds = [];

  const visitedContentIds = [];
  const visitedQuizIds = [];
  const visitedAssignmentIds = [];
  const visitedTopicIds = [];
  const visitedLessonIds = [];
  const visitedModuleIds = [];

  const collectDirect = (entity) => {
    entity.contents.forEach((c) => {
      if (c.completed) completedContentIds.push(c.id);
      if (c.visited) visitedContentIds.push(c.id);
    });
    entity.quizzes.forEach((q) => {
      if (q.completed) completedQuizIds.push(q.id);
      if (q.visited) visitedQuizIds.push(q.id);
    });
    entity.assignments.forEach((a) => {
      if (a.completed) completedAssignmentIds.push(a.id);
      if (a.visited) visitedAssignmentIds.push(a.id);
    });
  };

  collectDirect(hierarchy);
  for (const mod of hierarchy.modules) {
    collectDirect(mod);
    if (mod.completed) completedModuleIds.push(mod.id);
    if (mod.visited) visitedModuleIds.push(mod.id);
    for (const lesson of mod.lessons) {
      collectDirect(lesson);
      if (lesson.completed) completedLessonIds.push(lesson.id);
      if (lesson.visited) visitedLessonIds.push(lesson.id);
      for (const topic of lesson.topics) {
        collectDirect(topic);
        if (topic.completed) completedTopicIds.push(topic.id);
        if (topic.visited) visitedTopicIds.push(topic.id);
      }
    }
  }

  return {
    ...rollup,
    hierarchy,
    moduleProgresses: completedModuleIds,
    lessonProgresses: completedLessonIds,
    topicProgresses: completedTopicIds,
    completedContentIds,
    completedQuizIds,
    completedAssignmentIds,
    visitedModuleProgresses: visitedModuleIds,
    visitedLessonProgresses: visitedLessonIds,
    visitedTopicProgresses: visitedTopicIds,
    visitedContentIds,
    visitedQuizIds,
    visitedAssignmentIds
  };
}

/**
 * Marks one or more Content items (same studentId) complete/incomplete and
 * triggers bottom-up course progress rollup — once per distinct course, not
 * once per content id.
 *
 * A single player block can stand for several real Content rows (a merged
 * "document" view — see the frontend's groupLessonContentForDocumentView).
 * Recomputing the whole course roll-up separately for each row used to mean
 * N parallel reads-then-writes of the same Topic/Lesson/Module/Course
 * progress rows: whichever call's read happened before another call's write
 * committed would then persist a rollup that doesn't yet include that
 * other row's completion, silently reverting it (a lost update) — the
 * behavior behind "mark as complete" needing several clicks to stick. All
 * ContentProgress upserts now happen first, then one rollup per course reads
 * the fully-updated state.
 *
 * `contentId` may be a single id (existing single-item callers keep working
 * unchanged) or an array. When `requestingUser` is supplied (always, from
 * the HTTP layer) the caller's access to each owning course is verified
 * before any progress row for it is written, so an unenrolled student
 * cannot seed progress rows for a course.
 */
async function completeContent(studentId, contentId, completed = true, requestingUser = null) {
  const contentIds = [...new Set((Array.isArray(contentId) ? contentId : [contentId]).filter(Boolean))];

  if (contentIds.length === 0) {
    const error = new Error('contentId is required');
    error.statusCode = 400;
    throw error;
  }

  // Independent reads -- fetched together instead of one after the other.
  const [contents, existingRows] = await Promise.all([
    prisma.content.findMany({
      where: { id: { in: contentIds } },
      include: {
        topic: {
          include: {
            lesson: {
              include: {
                module: true
              }
            }
          }
        },
        lesson: {
          include: {
            module: true
          }
        },
        module: true
      }
    }),
    prisma.contentProgress.findMany({ where: { studentId, contentId: { in: contentIds } } })
  ]);

  if (contents.length !== contentIds.length) {
    const error = new Error('Content not found');
    error.statusCode = 404;
    throw error;
  }

  const courseIdOf = (content) =>
    content.topic?.lesson?.module?.courseId ||
    content.lesson?.module?.courseId ||
    content.module?.courseId ||
    content.courseId;

  const courseIds = new Set();
  for (const content of contents) {
    const courseId = courseIdOf(content);
    if (courseId) courseIds.add(courseId);
  }

  if (requestingUser) {
    await Promise.all([...courseIds].map((courseId) => assertCourseProgressAccess(requestingUser, studentId, courseId)));
  }

  await upsertContentCompletions(studentId, contentIds, completed, existingRows);

  // One rollup per distinct course (almost always exactly one — a merged
  // block's rows all come from the same lesson) instead of one per content id.
  // The ContentProgress writes above are already durable at this point: if
  // the rollup itself fails (a transient DB hiccup, a slow query), the
  // completion must still be reported as successful -- the row the student
  // actually asked to change is already saved, and the frontend must not
  // show "Mark as Complete" again for an item the database already has as
  // complete just because the DERIVED course-wide numbers couldn't be
  // recomputed this one time. The next read (or mutation) recomputes them.
  let rollup = null;
  for (const courseId of courseIds) {
    try {
      rollup = attachFlatProjections(await recomputeCourseProgress(studentId, courseId, null, { includeTree: true }));
    } catch (rollupError) {
      console.error('[progress] rollup failed after content completion committed', {
        studentId,
        contentIds,
        courseId,
        error: rollupError.message
      });
      rollup = null;
    }
  }

  return {
    contentId: contentIds.length === 1 ? contentIds[0] : contentIds,
    studentId,
    completed,
    courseProgress: rollup
  };
}

/**
 * Marks all topic-level content items within a lesson as complete/incomplete
 * and triggers bottom-up course progress rollup.
 */
async function completeLesson(studentId, lessonId, completed = true, requestingUser = null) {
  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
    include: {
      module: true,
      contents: true,
      topics: {
        where: { isPublished: true },
        include: {
          contents: true
        }
      }
    }
  });

  if (!lesson) {
    const error = new Error('Lesson not found');
    error.statusCode = 404;
    throw error;
  }

  const courseId = lesson.module.courseId;

  if (requestingUser) {
    await assertCourseProgressAccess(requestingUser, studentId, courseId);
  }

  const contentIds = [];
  lesson.contents.forEach((c) => contentIds.push(c.id));
  for (const topic of lesson.topics) {
    for (const c of topic.contents) {
      contentIds.push(c.id);
    }
  }

  const existingRows =
    contentIds.length > 0
      ? await prisma.contentProgress.findMany({ where: { studentId, contentId: { in: contentIds } } })
      : [];

  await upsertContentCompletions(studentId, contentIds, completed, existingRows);

  let rollup = null;
  try {
    rollup = attachFlatProjections(await recomputeCourseProgress(studentId, courseId, null, { includeTree: true }));
  } catch (rollupError) {
    console.error('[progress] rollup failed after lesson completion committed', {
      studentId,
      lessonId,
      courseId,
      error: rollupError.message
    });
  }

  return {
    lessonId,
    studentId,
    completed,
    courseProgress: rollup
  };
}

/**
 * Explicitly marks an item or container as visited/unvisited for a student
 * and triggers bottom-up course progress rollup.
 */
async function markVisited(studentId, params, visited = true, requestingUser = null) {
  let { entityType, entityId, contentId, quizId, assignmentId, topicId, lessonId, moduleId } =
    typeof params === 'string' ? { entityId: params } : (params || {});

  if (contentId) { entityType = 'CONTENT'; entityId = contentId; }
  else if (quizId) { entityType = 'QUIZ'; entityId = quizId; }
  else if (assignmentId) { entityType = 'ASSIGNMENT'; entityId = assignmentId; }
  else if (topicId) { entityType = 'TOPIC'; entityId = topicId; }
  else if (lessonId) { entityType = 'LESSON'; entityId = lessonId; }
  else if (moduleId) { entityType = 'MODULE'; entityId = moduleId; }

  entityType = (entityType || '').toUpperCase();

  let courseId = null;
  // Whether this call actually changed anything. Revisiting an
  // already-visited item is a no-op: no upsert, and (below) no rollup either
  // -- there is nothing new for a rollup to recompute, so it must not
  // burn a full course recompute on every re-open of the same content.
  let changed = true;

  if (entityType === 'CONTENT') {
    const content = await prisma.content.findUnique({
      where: { id: entityId },
      include: {
        topic: { include: { lesson: { include: { module: true } } } },
        lesson: { include: { module: true } },
        module: true
      }
    });
    if (!content) throw Object.assign(new Error('Content not found'), { statusCode: 404 });
    courseId = content.topic?.lesson?.module?.courseId || content.lesson?.module?.courseId || content.module?.courseId || content.courseId;
    if (requestingUser && courseId) await assertCourseProgressAccess(requestingUser, studentId, courseId);

    ({ changed } = await upsertVisitedIfNeeded(
      prisma.contentProgress,
      { studentId_contentId: { studentId, contentId: entityId } },
      { studentId, contentId: entityId },
      visited
    ));
  } else if (entityType === 'QUIZ') {
    const quiz = await prisma.quiz.findUnique({
      where: { id: entityId },
      include: {
        topic: { include: { lesson: { include: { module: true } } } },
        lesson: { include: { module: true } },
        module: true
      }
    });
    if (!quiz) throw Object.assign(new Error('Quiz not found'), { statusCode: 404 });
    courseId = quiz.topic?.lesson?.module?.courseId || quiz.lesson?.module?.courseId || quiz.module?.courseId || quiz.courseId;
    if (requestingUser && courseId) await assertCourseProgressAccess(requestingUser, studentId, courseId);

    ({ changed } = await upsertVisitedIfNeeded(
      prisma.quizProgress,
      { studentId_quizId: { studentId, quizId: entityId } },
      { studentId, quizId: entityId },
      visited
    ));
  } else if (entityType === 'ASSIGNMENT') {
    const assignment = await prisma.assignment.findUnique({
      where: { id: entityId },
      include: {
        topic: { include: { lesson: { include: { module: true } } } },
        lesson: { include: { module: true } },
        module: true
      }
    });
    if (!assignment) throw Object.assign(new Error('Assignment not found'), { statusCode: 404 });
    courseId = assignment.topic?.lesson?.module?.courseId || assignment.lesson?.module?.courseId || assignment.module?.courseId || assignment.courseId;
    if (requestingUser && courseId) await assertCourseProgressAccess(requestingUser, studentId, courseId);

    ({ changed } = await upsertVisitedIfNeeded(
      prisma.assignmentProgress,
      { studentId_assignmentId: { studentId, assignmentId: entityId } },
      { studentId, assignmentId: entityId },
      visited
    ));
  } else if (entityType === 'TOPIC') {
    const topic = await prisma.topic.findUnique({
      where: { id: entityId },
      include: { lesson: { include: { module: true } } }
    });
    if (!topic) throw Object.assign(new Error('Topic not found'), { statusCode: 404 });
    courseId = topic.lesson.module.courseId;
    if (requestingUser && courseId) await assertCourseProgressAccess(requestingUser, studentId, courseId);

    ({ changed } = await upsertVisitedIfNeeded(
      prisma.topicProgress,
      { studentId_topicId: { studentId, topicId: entityId } },
      { studentId, topicId: entityId },
      visited
    ));
  } else if (entityType === 'LESSON') {
    const lesson = await prisma.lesson.findUnique({
      where: { id: entityId },
      include: { module: true }
    });
    if (!lesson) throw Object.assign(new Error('Lesson not found'), { statusCode: 404 });
    courseId = lesson.module.courseId;
    if (requestingUser && courseId) await assertCourseProgressAccess(requestingUser, studentId, courseId);

    ({ changed } = await upsertVisitedIfNeeded(
      prisma.lessonProgress,
      { studentId_lessonId: { studentId, lessonId: entityId } },
      { studentId, lessonId: entityId },
      visited
    ));
  } else if (entityType === 'MODULE') {
    const moduleItem = await prisma.module.findUnique({
      where: { id: entityId }
    });
    if (!moduleItem) throw Object.assign(new Error('Module not found'), { statusCode: 404 });
    courseId = moduleItem.courseId;
    if (requestingUser && courseId) await assertCourseProgressAccess(requestingUser, studentId, courseId);

    ({ changed } = await upsertVisitedIfNeeded(
      prisma.moduleProgress,
      { studentId_moduleId: { studentId, moduleId: entityId } },
      { studentId, moduleId: entityId },
      visited
    ));
  } else {
    throw Object.assign(new Error('Invalid entity type for visited progress'), { statusCode: 400 });
  }

  let rollup = null;
  if (courseId && changed) {
    try {
      rollup = attachFlatProjections(await recomputeCourseProgress(studentId, courseId, null, { includeTree: true }));
    } catch (rollupError) {
      console.error('[progress] rollup failed after visit committed', {
        studentId,
        entityType,
        entityId,
        courseId,
        error: rollupError.message
      });
    }
  }

  return {
    entityType,
    entityId,
    studentId,
    visited,
    changed,
    courseProgress: rollup
  };
}

/**
 * Authorizes a request to read a student's progress in a course.
 *
 * - ADMIN may read any student's progress.
 * - INSTRUCTOR may read progress only for courses they created.
 * - Everyone else may read only their own progress, and only for a course they
 *   are enrolled in.
 *
 * Called from the controller, where the requesting user is known, so the
 * progress services themselves stay pure and directly unit-testable.
 */
async function assertCourseProgressAccess(requestingUser, studentId, courseId) {
  const role = requestingUser?.role;

  if (role === 'ADMIN') return;

  if (role === 'INSTRUCTOR') {
    const course = await prisma.course.findUnique({
      where: { id: courseId },
      select: { creatorId: true }
    });
    if (!course) {
      const error = new Error('Course not found');
      error.statusCode = 404;
      throw error;
    }
    if (course.creatorId !== requestingUser.id) {
      const error = new Error('Forbidden: you do not own this course');
      error.statusCode = 403;
      throw error;
    }
    return;
  }

  const enrollment = await prisma.enrollment.findUnique({
    where: { studentId_courseId: { studentId, courseId } },
    select: { id: true }
  });

  if (!enrollment) {
    const error = new Error('Forbidden: you are not enrolled in this course');
    error.statusCode = 403;
    throw error;
  }
}

/**
 * Retrieves detailed, course-scoped progress for a student, including the
 * authoritative hierarchical tree
 * (Course -> Module -> Lesson -> Topic -> Content/Quiz/Assignment).
 *
 * The flat id arrays are derived from that same tree, so they are scoped to
 * this course only and can never disagree with the hierarchy or the totals.
 */
async function getStudentCourseProgress(studentId, courseId) {
  const rollup = await recomputeCourseProgress(studentId, courseId, null, { includeTree: true });
  return attachFlatProjections(rollup);
}

/**
 * Retrieves progress overview across all enrolled courses for a student.
 */
async function getStudentOverallProgress(studentId) {
  const enrollments = await prisma.enrollment.findMany({
    where: { studentId },
    include: {
      course: {
        select: {
          id: true,
          title: true,
          thumbnailUrl: true,
          category: true,
          level: true
        }
      }
    }
  });

  const validEnrollments = enrollments.filter((enc) => enc.course);

  const results = await Promise.all(
    validEnrollments.map(async (enc) => {
      const rollup = await recomputeCourseProgress(studentId, enc.courseId);
      return {
        courseId: enc.courseId,
        courseTitle: enc.course.title,
        thumbnailUrl: enc.course.thumbnailUrl,
        category: enc.course.category,
        level: enc.course.level,
        progressPercent: rollup.progressPercent,
        completed: rollup.completed,
        completedAt: enc.completedAt,
        lastAccessedAt: enc.lastAccessedAt,
        enrolledAt: enc.enrolledAt,
        totalItems: rollup.totalItems,
        completedItems: rollup.completedItems
      };
    })
  );

  return results;
}

/**
 * Instructor Analytics — retrieves read-only progress analytics for a course.
 */
async function getInstructorCourseProgress(courseId) {
  const enrollments = await prisma.enrollment.findMany({
    where: { courseId },
    include: {
      student: {
        include: {
          user: {
            select: { name: true, email: true }
          }
        }
      }
    }
  });

  const totalStudents = enrollments.length;
  let completedStudents = 0;
  let inProgressStudents = 0;
  let totalPercentSum = 0;

  const studentList = [];

  for (const enc of enrollments) {
    // Read-only: an instructor viewing analytics must not write progress rows
    // or stamp every student's lastAccessedAt with "now".
    const rollup = await recomputeCourseProgress(enc.studentId, courseId, null, { persist: false });
    const percent = rollup.progressPercent;
    totalPercentSum += percent;

    let status = 'Not Started';
    if (rollup.completed) {
      status = 'Completed';
      completedStudents++;
    } else if (percent > 0) {
      status = 'In Progress';
      inProgressStudents++;
    }

    studentList.push({
      studentId: enc.studentId,
      name: enc.student?.user?.name || 'Student',
      email: enc.student?.user?.email || '',
      progressPercent: percent,
      completedItems: rollup.completedItems,
      totalItems: rollup.totalItems,
      status,
      lastAccessedAt: enc.lastAccessedAt || enc.enrolledAt
    });
  }

  const avgProgressPercent = totalStudents > 0 ? Math.round(totalPercentSum / totalStudents) : 0;

  return {
    overview: {
      totalStudents,
      completedStudents,
      inProgressStudents,
      avgProgressPercent
    },
    students: studentList
  };
}

module.exports = {
  assertCourseProgressAccess,
  completeContent,
  completeLesson,
  markVisited,
  getStudentCourseProgress,
  getStudentOverallProgress,
  getInstructorCourseProgress,
  ensureProgressInitialized
};
