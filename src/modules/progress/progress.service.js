const prisma = require('../../config/database');
const { recomputeCourseProgress, ensureProgressInitialized } = require('../../utils/progressRollup');
const { buildLearningPath, resolveNextItem } = require('../../utils/learningPath');
const { buildLearningSequence, findStepForContent } = require('../../utils/learningSequence');
const { getCourseQualifyingQuizzes } = require('../../utils/qualification');
const { isAssessmentContent } = require('../contents/contentOrder.util');
const {
  COURSE_ID_INCLUDE,
  resolveCourseId
} = require('../../utils/helpers/courseBreadcrumb.helper');

const forbidden = (message) => Object.assign(new Error(message), { statusCode: 403 });

/** Every Content id the roll-up hierarchy holds, at every level. */
function collectHierarchyContentIds(hierarchy) {
  const ids = [];
  const walk = (node) => {
    if (!node) return;
    for (const item of node.items || []) ids.push(item.contentId);
    for (const child of [
      ...(node.modules || []),
      ...(node.lessons || []),
      ...(node.topics || []),
      ...(node.subTopics || []),
      ...(node.concepts || [])
    ]) {
      walk(child);
    }
  };
  walk(hierarchy);
  return ids;
}

const BODY_SELECT = {
  id: true,
  type: true,
  title: true,
  videoUrl: true,
  fileUrl: true,
  htmlContent: true,
  externalUrl: true,
  duration: true,
  data: true
};

/**
 * Content body columns for the sequence builder. Document merging only ever
 * looks at HTML rows, so an access check (`allBodies: false`) loads just
 * those; the learning-sequence endpoint loads everything it may hand out.
 */
async function loadSequenceBodies(hierarchy, { allBodies }) {
  const ids = collectHierarchyContentIds(hierarchy);
  if (ids.length === 0) return new Map();
  const rows = await prisma.content.findMany({
    where: { id: { in: ids }, ...(allBodies ? {} : { type: 'HTML' }) },
    select: allBodies ? BODY_SELECT : { id: true, type: true, title: true, htmlContent: true }
  });
  return new Map(rows.map((row) => [row.id, row]));
}

/**
 * The student's learning sequence for a course: the roll-up (the single
 * source of completion) turned into ordered, lock-stamped steps.
 *
 * `persist: false` for access checks, which must not write progress rows.
 */
async function computeStudentSequence(studentId, courseId, { persist = false, allBodies = false } = {}) {
  const rollup = await recomputeCourseProgress(studentId, courseId, null, { includeTree: true, persist });
  const bodies = await loadSequenceBodies(rollup.hierarchy, { allBodies });
  return { rollup, sequence: buildLearningSequence(rollup.hierarchy, { bodies }) };
}

/**
 * Throws 403 unless every one of `contentIds` is an open step of this
 * student's learning sequence. THE server-side gate: opening, completing or
 * visiting content and opening/submitting a quiz or assignment all come
 * through here, so a student who skips the player (a typed URL, a direct API
 * call) is refused exactly as the player would refuse them.
 *
 * A Content row that is not a step (unpublished, or not in this course's
 * published tree) is not this check's concern — the caller's own
 * existence/enrollment checks still apply.
 */
async function assertContentsAccessible(studentId, courseId, contentIds) {
  const ids = [...new Set((contentIds || []).filter(Boolean))];
  if (!courseId || ids.length === 0) return;

  const { sequence } = await computeStudentSequence(studentId, courseId);
  for (const id of ids) {
    const step = findStepForContent(sequence, id);
    if (!step?.locked) continue;
    const blocker = sequence.steps[step.blockedByIndex];
    throw forbidden(
      blocker
        ? `Finish “${blocker.title || 'the previous item'}” before opening this item.`
        : 'Finish the earlier items in this course before opening this item.'
    );
  }
}

/**
 * The same gate, addressed by the Quiz or Assignment a student is opening or
 * submitting. A quiz/assignment with no Content wrapper is not a sequence item
 * (a QUALIFYING test, a batch assessment, a practice quiz) and is not gated
 * here — those have their own rules.
 */
async function assertSequenceItemAccessible(studentId, { quizId = null, assignmentId = null }) {
  const where = quizId ? { quizId } : assignmentId ? { assignmentId } : null;
  if (!where || !studentId) return;
  const wrapper = await prisma.content.findUnique({ where, include: COURSE_ID_INCLUDE });
  if (!wrapper) return;
  const courseId = resolveCourseId(wrapper);
  // A course item is only for students enrolled in that course.
  await assertCourseProgressAccess({ role: 'STUDENT' }, studentId, courseId);
  await assertContentsAccessible(studentId, courseId, [wrapper.id]);
}

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
  const completedConceptIds = [];
  const completedSubTopicIds = [];
  const completedTopicIds = [];
  const completedLessonIds = [];
  const completedModuleIds = [];

  const visitedContentIds = [];
  const visitedQuizIds = [];
  const visitedAssignmentIds = [];
  const visitedConceptIds = [];
  const visitedSubTopicIds = [];
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

  // Records a container's own completed/visited flags into the right pair of
  // flat arrays. The nested walk below stays a plain set of loops so the tree
  // shape is still readable at a glance.
  const collectContainer = (entity, completedIds, visitedIds) => {
    collectDirect(entity);
    if (entity.completed) completedIds.push(entity.id);
    if (entity.visited) visitedIds.push(entity.id);
  };

  collectDirect(hierarchy);
  for (const mod of hierarchy.modules) {
    collectContainer(mod, completedModuleIds, visitedModuleIds);
    for (const lesson of mod.lessons) {
      collectContainer(lesson, completedLessonIds, visitedLessonIds);
      for (const topic of lesson.topics) {
        collectContainer(topic, completedTopicIds, visitedTopicIds);
        // `subTopics` is always present on a freshly computed tree, but an
        // older cached rollup passed back in would not have it -- default to
        // [] rather than throwing.
        for (const subTopic of topic.subTopics || []) {
          collectContainer(subTopic, completedSubTopicIds, visitedSubTopicIds);
          for (const concept of subTopic.concepts || []) {
            collectContainer(concept, completedConceptIds, visitedConceptIds);
          }
        }
      }
    }
  }

  return {
    ...rollup,
    hierarchy,
    // Existing field names and meanings are unchanged, so current API
    // consumers keep working untouched.
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
    visitedAssignmentIds,
    // New, additive: empty arrays for any course without SubTopics/Concepts.
    subTopicProgresses: completedSubTopicIds,
    conceptProgresses: completedConceptIds,
    visitedSubTopicProgresses: visitedSubTopicIds,
    visitedConceptProgresses: visitedConceptIds
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
      include: COURSE_ID_INCLUDE
    }),
    prisma.contentProgress.findMany({ where: { studentId, contentId: { in: contentIds } } })
  ]);

  if (contents.length !== contentIds.length) {
    const error = new Error('Content not found');
    error.statusCode = 404;
    throw error;
  }

  // A Quiz or Assignment item is complete when the Quiz/Assignment says so
  // (utils/itemCompletion.js) — never because someone asserted it here.
  if (contents.some(isAssessmentContent)) {
    const error = new Error('A quiz or assignment is completed by submitting it, not by marking it complete.');
    error.statusCode = 400;
    throw error;
  }

  const contentIdsByCourse = new Map();
  for (const content of contents) {
    const courseId = resolveCourseId(content);
    if (!courseId) continue;
    if (!contentIdsByCourse.has(courseId)) contentIdsByCourse.set(courseId, []);
    contentIdsByCourse.get(courseId).push(content.id);
  }
  const courseIds = new Set(contentIdsByCourse.keys());

  if (requestingUser) {
    await Promise.all([...courseIds].map((courseId) => assertCourseProgressAccess(requestingUser, studentId, courseId)));

    // Sequential learning, enforced where it actually matters: a student may
    // not record progress on a step they have not reached. The player already
    // refuses to navigate there, but a client that skips that check — or calls
    // this endpoint directly — must be refused too, or the gate is decoration.
    // Only students are gated: an instructor or admin correcting a student's
    // progress is not walking the path.
    if (requestingUser.role === 'STUDENT') {
      for (const [courseId, ids] of contentIdsByCourse) {
        await assertContentsAccessible(studentId, courseId, ids);
      }
    }
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
          contents: true,
          // Without these two levels "mark lesson complete" would write only
          // the Topic-direct rows, and the roll-up would immediately recompute
          // the lesson as INCOMPLETE -- the mutation would report success
          // while the percentage never moved. Published-only, matching the
          // existing topics filter, so drafts are never force-completed.
          subTopics: {
            where: { isPublished: true },
            include: {
              contents: true,
              concepts: {
                where: { isPublished: true },
                include: { contents: true }
              }
            }
          }
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

  // Ordinary content only: a Quiz/Assignment item is completed by its own
  // submission (utils/itemCompletion.js), never by bulk-marking.
  const contentIds = [];
  const take = (rows) => rows.filter((c) => !isAssessmentContent(c)).forEach((c) => contentIds.push(c.id));
  take(lesson.contents);
  for (const topic of lesson.topics) {
    take(topic.contents);
    for (const subTopic of topic.subTopics) {
      take(subTopic.contents);
      for (const concept of subTopic.concepts) {
        take(concept.contents);
      }
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
  let {
    entityType,
    entityId,
    contentId,
    quizId,
    assignmentId,
    conceptId,
    subTopicId,
    topicId,
    lessonId,
    moduleId
  } = typeof params === 'string' ? { entityId: params } : (params || {});

  // Most-specific id wins, so a caller that sends both a conceptId and its
  // ancestor topicId marks the concept -- matching the precedence used for
  // Quiz parents and by the ownership dispatchers.
  if (contentId) { entityType = 'CONTENT'; entityId = contentId; }
  else if (quizId) { entityType = 'QUIZ'; entityId = quizId; }
  else if (assignmentId) { entityType = 'ASSIGNMENT'; entityId = assignmentId; }
  else if (conceptId) { entityType = 'CONCEPT'; entityId = conceptId; }
  else if (subTopicId) { entityType = 'SUBTOPIC'; entityId = subTopicId; }
  else if (topicId) { entityType = 'TOPIC'; entityId = topicId; }
  else if (lessonId) { entityType = 'LESSON'; entityId = lessonId; }
  else if (moduleId) { entityType = 'MODULE'; entityId = moduleId; }

  entityType = (entityType || '').toUpperCase();

  // How to find each entity's owning course, and which progress table records
  // its visit. Replaces a six-branch if/else in which the three leaf branches
  // repeated the same include and the same coalescing chain verbatim -- that
  // duplication is exactly what would have silently dropped SubTopic/Concept
  // items, because each copy stopped at `topic`.
  //
  // Leaf items (CONTENT/QUIZ/ASSIGNMENT) hang off any of the six levels, so
  // they resolve their course via COURSE_ID_INCLUDE. Containers know their
  // own place in the tree, so each names its own upward path.
  const ENTITY_HANDLERS = {
    CONTENT: {
      model: () => prisma.content,
      include: COURSE_ID_INCLUDE,
      notFound: 'Content not found',
      progress: () => prisma.contentProgress,
      idField: 'contentId'
    },
    QUIZ: {
      model: () => prisma.quiz,
      include: COURSE_ID_INCLUDE,
      notFound: 'Quiz not found',
      progress: () => prisma.quizProgress,
      idField: 'quizId'
    },
    ASSIGNMENT: {
      model: () => prisma.assignment,
      include: COURSE_ID_INCLUDE,
      notFound: 'Assignment not found',
      progress: () => prisma.assignmentProgress,
      idField: 'assignmentId'
    },
    CONCEPT: {
      model: () => prisma.concept,
      include: {
        subTopic: {
          include: { topic: { include: { lesson: { include: { module: true } } } } }
        }
      },
      courseIdOf: (c) => c.subTopic?.topic?.lesson?.module?.courseId,
      notFound: 'Concept not found',
      progress: () => prisma.conceptProgress,
      idField: 'conceptId'
    },
    SUBTOPIC: {
      model: () => prisma.subTopic,
      include: { topic: { include: { lesson: { include: { module: true } } } } },
      courseIdOf: (s) => s.topic?.lesson?.module?.courseId,
      notFound: 'SubTopic not found',
      progress: () => prisma.subTopicProgress,
      idField: 'subTopicId'
    },
    TOPIC: {
      model: () => prisma.topic,
      include: { lesson: { include: { module: true } } },
      courseIdOf: (t) => t.lesson?.module?.courseId,
      notFound: 'Topic not found',
      progress: () => prisma.topicProgress,
      idField: 'topicId'
    },
    LESSON: {
      model: () => prisma.lesson,
      include: { module: true },
      courseIdOf: (l) => l.module?.courseId,
      notFound: 'Lesson not found',
      progress: () => prisma.lessonProgress,
      idField: 'lessonId'
    },
    MODULE: {
      model: () => prisma.module,
      include: undefined,
      courseIdOf: (m) => m.courseId,
      notFound: 'Module not found',
      progress: () => prisma.moduleProgress,
      idField: 'moduleId'
    }
  };

  const handler = ENTITY_HANDLERS[entityType];
  if (!handler) {
    throw Object.assign(new Error('Invalid entity type for visited progress'), { statusCode: 400 });
  }

  const entity = await handler.model().findUnique({
    where: { id: entityId },
    ...(handler.include ? { include: handler.include } : {})
  });
  if (!entity) throw Object.assign(new Error(handler.notFound), { statusCode: 404 });

  const courseId = handler.courseIdOf ? handler.courseIdOf(entity) : resolveCourseId(entity);

  if (requestingUser && courseId) {
    await assertCourseProgressAccess(requestingUser, studentId, courseId);
  }

  // A Quiz/Assignment in the learning sequence is visited through its Content
  // row — ContentProgress is the sequence-level progress of every item.
  // Unwrapped ones (qualifying tests, batch assessments) keep their own rows.
  let progressHandler = handler;
  let progressEntityId = entityId;
  if (entityType === 'QUIZ' || entityType === 'ASSIGNMENT') {
    const wrapper = await prisma.content.findUnique({
      where: entityType === 'QUIZ' ? { quizId: entityId } : { assignmentId: entityId },
      select: { id: true }
    });
    if (wrapper) {
      progressHandler = ENTITY_HANDLERS.CONTENT;
      progressEntityId = wrapper.id;
    }
  }

  // A recorded visit keeps a step open for good (visited steps never
  // re-lock), so a student may only visit a step they may already open.
  if (requestingUser?.role === 'STUDENT' && courseId && visited && progressHandler === ENTITY_HANDLERS.CONTENT) {
    await assertContentsAccessible(studentId, courseId, [progressEntityId]);
  }

  // Whether this call actually changed anything. Revisiting an
  // already-visited item is a no-op: no upsert, and (below) no rollup either
  // -- there is nothing new for a rollup to recompute, so it must not
  // burn a full course recompute on every re-open of the same content.
  const { changed } = await upsertVisitedIfNeeded(
    progressHandler.progress(),
    { [`studentId_${progressHandler.idField}`]: { studentId, [progressHandler.idField]: progressEntityId } },
    { studentId, [progressHandler.idField]: progressEntityId },
    visited
  );

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
 * The student's ordered path through a course: every module/lesson/topic in
 * course order with its status (completed / qualified / current / available /
 * locked) and, where one is on offer, the qualifying test that would let them
 * skip it.
 *
 * Computed from the same roll-up the progress tree is built from, so the
 * sequence the player draws and the sequence the API enforces are the same
 * one. Returns an array — the ordering is the point, and callers index into
 * it — with the path's derived summary attached separately by the controller.
 */
async function getStudentLearningPath(studentId, courseId) {
  const [{ rollup, sequence }, qualifyingQuizzes] = await Promise.all([
    computeStudentSequence(studentId, courseId, { persist: true }),
    // Student-scoped, so each qualifying quiz carries this student's remaining
    // allowance and the path can stop offering a skip they cannot take.
    getCourseQualifyingQuizzes(courseId, null, studentId)
  ]);

  return buildLearningPath(rollup.hierarchy, qualifyingQuizzes, sequence);
}

/**
 * THE student learning sequence for a course — what the player steps
 * through, what the Course Map draws, where "Continue learning" lands, and
 * what the server lets the student open. Steps the student may not open yet
 * carry no material (`body: null`).
 */
async function getStudentLearningSequence(studentId, courseId) {
  const { rollup, sequence } = await computeStudentSequence(studentId, courseId, {
    persist: true,
    allBodies: true
  });

  return {
    courseId,
    title: rollup.hierarchy.title,
    progress: {
      progressPercent: rollup.progressPercent,
      completedItems: rollup.completedItems,
      totalItems: rollup.totalItems,
      completed: rollup.completed
    },
    steps: sequence.steps,
    tree: sequence.tree,
    currentIndex: sequence.currentIndex,
    resumeIndex: sequence.resumeIndex
  };
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
  assertContentsAccessible,
  assertSequenceItemAccessible,
  computeStudentSequence,
  completeContent,
  completeLesson,
  markVisited,
  getStudentCourseProgress,
  getStudentLearningPath,
  getStudentLearningSequence,
  resolveNextItem,
  getStudentOverallProgress,
  getInstructorCourseProgress,
  ensureProgressInitialized
};
