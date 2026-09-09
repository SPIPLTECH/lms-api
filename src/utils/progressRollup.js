const prisma = require('../config/database');

/**
 * Authoritative bottom-up multi-entity progress roll-up engine.
 *
 * Participated Entity Types:
 * - Content (direct at Course, Module, Lesson, Topic levels)
 * - Quiz (direct at Course, Module, Lesson, Topic levels)
 * - Assignment (direct at Course, Module, Lesson, Topic levels)
 *
 * Rules:
 * 1. Only published, student-accessible items are counted.
 * 2. Empty containers (0 applicable items/children) CANNOT complete (completed = false)
 *    and are excluded from their parent's denominator so empty containers do not block completion.
 * 3. A parent container completes iff ALL applicable direct items AND ALL applicable child entities complete.
 * 4. Ground Truth Completions:
 *    - Content: ContentProgress row with completed = true
 *    - Quiz: QuizSubmission row with passed = true (or percentage >= passingScore)
 *    - Assignment: AssignmentSubmission row with status in ["Submitted", "Graded"]
 * 5. Idempotent and transaction-aware. Preserves completedAt when remaining complete; updates or resets on status flip.
 *
 * Pass `options.includeTree` to also receive the authoritative hierarchical progress
 * tree (Course -> Module -> Lesson -> Topic -> Content/Quiz/Assignment). It is built
 * from the exact same applicable-item set the percentages are derived from, so the
 * Student frontend never has to reconstruct the hierarchy from unrelated APIs and can
 * never disagree with the backend about what counts.
 */
const ASSIGNMENT_COMPLETED_STATUSES = ['Submitted', 'Graded'];

function isAssignmentSubmissionComplete(submission) {
  return !!submission && ASSIGNMENT_COMPLETED_STATUSES.includes(submission.status);
}

async function recomputeCourseProgress(studentId, courseId, tx = null, options = {}) {
  const client = tx || prisma;
  const includeTree = options.includeTree === true;

  const contentSelect = { id: true, title: true, type: true, order: true, duration: true };
  const quizSelect = { id: true, title: true, order: true, passingScore: true };
  const assignmentSelect = { id: true, title: true, dueDate: true };

  // 1. Fetch live published hierarchy including direct Contents, Quizzes, Assignments at all levels
  const course = await client.course.findUnique({
    where: { id: courseId },
    select: {
      id: true,
      title: true,
      status: true,
      contents: {
        where: { moduleId: null, lessonId: null, topicId: null },
        orderBy: { order: 'asc' },
        select: contentSelect
      },
      quizzes: {
        where: { isPublished: true, moduleId: null, lessonId: null, topicId: null },
        orderBy: { order: 'asc' },
        select: quizSelect
      },
      assignments: {
        where: { isPublished: true, moduleId: null, lessonId: null, topicId: null },
        select: assignmentSelect
      },
      modules: {
        where: { isPublished: true },
        orderBy: { order: 'asc' },
        select: {
          id: true,
          title: true,
          order: true,
          contents: {
            where: { lessonId: null, topicId: null },
            orderBy: { order: 'asc' },
            select: contentSelect
          },
          quizzes: {
            where: { isPublished: true, lessonId: null, topicId: null },
            orderBy: { order: 'asc' },
            select: quizSelect
          },
          assignments: {
            where: { isPublished: true, lessonId: null, topicId: null },
            select: assignmentSelect
          },
          lessons: {
            where: { isPublished: true },
            orderBy: { order: 'asc' },
            select: {
              id: true,
              title: true,
              order: true,
              contents: {
                where: { topicId: null },
                orderBy: { order: 'asc' },
                select: contentSelect
              },
              quizzes: {
                where: { isPublished: true, topicId: null },
                orderBy: { order: 'asc' },
                select: quizSelect
              },
              assignments: {
                where: { isPublished: true, topicId: null },
                select: assignmentSelect
              },
              topics: {
                where: { isPublished: true },
                orderBy: { order: 'asc' },
                select: {
                  id: true,
                  title: true,
                  order: true,
                  contents: {
                    orderBy: { order: 'asc' },
                    select: contentSelect
                  },
                  quizzes: {
                    where: { isPublished: true },
                    orderBy: { order: 'asc' },
                    select: quizSelect
                  },
                  assignments: {
                    where: { isPublished: true },
                    select: assignmentSelect
                  }
                }
              }
            }
          }
        }
      }
    }
  });

  if (!course) {
    throw new Error(`Course with ID ${courseId} not found`);
  }

  // 2. Collect all item IDs across all 4 levels
  const allContentIds = new Set();
  const allQuizMap = new Map(); // quizId -> passingScore
  const allAssignmentIds = new Set();

  // Course direct
  course.contents.forEach((c) => allContentIds.add(c.id));
  course.quizzes.forEach((q) => allQuizMap.set(q.id, q.passingScore));
  course.assignments.forEach((a) => allAssignmentIds.add(a.id));

  // Modules, Lessons, Topics
  for (const mod of course.modules) {
    mod.contents.forEach((c) => allContentIds.add(c.id));
    mod.quizzes.forEach((q) => allQuizMap.set(q.id, q.passingScore));
    mod.assignments.forEach((a) => allAssignmentIds.add(a.id));

    for (const lesson of mod.lessons) {
      lesson.contents.forEach((c) => allContentIds.add(c.id));
      lesson.quizzes.forEach((q) => allQuizMap.set(q.id, q.passingScore));
      lesson.assignments.forEach((a) => allAssignmentIds.add(a.id));

      for (const topic of lesson.topics) {
        topic.contents.forEach((c) => allContentIds.add(c.id));
        topic.quizzes.forEach((q) => allQuizMap.set(q.id, q.passingScore));
        topic.assignments.forEach((a) => allAssignmentIds.add(a.id));
      }
    }
  }

  // 3. Fetch Ground Truth completions for Student
  // A. Content Completions
  const completedContentSet = new Set();
  const contentProgressMap = new Map();
  if (allContentIds.size > 0) {
    const cpRecords = await client.contentProgress.findMany({
      where: { studentId, contentId: { in: Array.from(allContentIds) } },
      select: { contentId: true, completed: true, completedAt: true }
    });
    cpRecords.forEach((r) => {
      contentProgressMap.set(r.contentId, r);
      if (r.completed) completedContentSet.add(r.contentId);
    });
  }

  // B. Quiz Completions (QuizSubmission with passed = true, or percentage >= passingScore)
  const completedQuizSet = new Set();
  const quizSubmissionMap = new Map();
  if (allQuizMap.size > 0) {
    const qsRecords = await client.quizSubmission.findMany({
      where: { studentId, quizId: { in: Array.from(allQuizMap.keys()) } },
      select: { quizId: true, passed: true, percentage: true, score: true, totalMarks: true, submittedAt: true }
    });
    qsRecords.forEach((qs) => {
      quizSubmissionMap.set(qs.quizId, qs);
      const minPassScore = allQuizMap.get(qs.quizId) || 0;
      if (qs.passed || (qs.percentage !== undefined && qs.percentage >= minPassScore)) {
        completedQuizSet.add(qs.quizId);
      }
    });
  }

  // C. Assignment Completions (AssignmentSubmission)
  const completedAssignmentSet = new Set();
  const assignmentSubmissionMap = new Map();
  if (allAssignmentIds.size > 0) {
    const asRecords = await client.assignmentSubmission.findMany({
      where: {
        studentId,
        assignmentId: { in: Array.from(allAssignmentIds) }
      },
      select: { assignmentId: true, status: true, grade: true, submittedAt: true }
    });
    asRecords.forEach((r) => {
      assignmentSubmissionMap.set(r.assignmentId, r);
      if (isAssignmentSubmissionComplete(r)) completedAssignmentSet.add(r.assignmentId);
    });
  }

  // Fetch existing topic/lesson/module progress to preserve completedAt
  const existingTopicProgresses = await client.topicProgress.findMany({
    where: { studentId },
    select: { topicId: true, completed: true, completedAt: true }
  });
  const topicProgressMap = new Map(existingTopicProgresses.map((tp) => [tp.topicId, tp]));

  const existingLessonProgresses = await client.lessonProgress.findMany({
    where: { studentId },
    select: { lessonId: true, completed: true, completedAt: true }
  });
  const lessonProgressMap = new Map(existingLessonProgresses.map((lp) => [lp.lessonId, lp]));

  const existingModuleProgresses = await client.moduleProgress.findMany({
    where: { studentId },
    select: { moduleId: true, completed: true, completedAt: true }
  });
  const moduleProgressMap = new Map(existingModuleProgresses.map((mp) => [mp.moduleId, mp]));

  const now = new Date();

  // In-memory status maps for bottom-up computation
  const topicCompletionStatus = new Map();
  const topicHasApplicableItemsMap = new Map();
  const topicCompletedAtMap = new Map();
  const lessonCompletionStatus = new Map();
  const lessonHasApplicableItemsMap = new Map();
  const lessonCompletedAtMap = new Map();
  const moduleCompletionStatus = new Map();
  const moduleHasApplicableItemsMap = new Map();
  const moduleCompletedAtMap = new Map();

  // 4. Roll up TOPIC Progress
  for (const mod of course.modules) {
    for (const lesson of mod.lessons) {
      for (const topic of lesson.topics) {
        const topicContents = topic.contents;
        const topicQuizzes = topic.quizzes;
        const topicAssignments = topic.assignments;
        const hasItems = (topicContents.length + topicQuizzes.length + topicAssignments.length) > 0;
        topicHasApplicableItemsMap.set(topic.id, hasItems);

        const contentsCompleted = topicContents.every((c) => completedContentSet.has(c.id));
        const quizzesCompleted = topicQuizzes.every((q) => completedQuizSet.has(q.id));
        const assignmentsCompleted = topicAssignments.every((a) => completedAssignmentSet.has(a.id));

        const isCompleted = hasItems && contentsCompleted && quizzesCompleted && assignmentsCompleted;
        topicCompletionStatus.set(topic.id, isCompleted);

        const existing = topicProgressMap.get(topic.id);
        const completedAt = isCompleted ? (existing?.completed ? existing.completedAt : now) : null;
        topicCompletedAtMap.set(topic.id, completedAt);

        await client.topicProgress.upsert({
          where: { studentId_topicId: { studentId, topicId: topic.id } },
          create: { studentId, topicId: topic.id, completed: isCompleted, completedAt },
          update: { completed: isCompleted, completedAt }
        });
      }
    }
  }

  // 5. Roll up LESSON Progress
  for (const mod of course.modules) {
    for (const lesson of mod.lessons) {
      const lessonContents = lesson.contents;
      const lessonQuizzes = lesson.quizzes;
      const lessonAssignments = lesson.assignments;
      const applicableTopics = lesson.topics.filter((t) => topicHasApplicableItemsMap.get(t.id) === true);

      const hasDirectItemsOrTopics = (lessonContents.length + lessonQuizzes.length + lessonAssignments.length + applicableTopics.length) > 0;
      lessonHasApplicableItemsMap.set(lesson.id, hasDirectItemsOrTopics);

      const directContentsCompleted = lessonContents.every((c) => completedContentSet.has(c.id));
      const directQuizzesCompleted = lessonQuizzes.every((q) => completedQuizSet.has(q.id));
      const directAssignmentsCompleted = lessonAssignments.every((a) => completedAssignmentSet.has(a.id));
      const topicsCompleted = applicableTopics.every((t) => topicCompletionStatus.get(t.id) === true);

      const isCompleted = hasDirectItemsOrTopics && directContentsCompleted && directQuizzesCompleted && directAssignmentsCompleted && topicsCompleted;
      lessonCompletionStatus.set(lesson.id, isCompleted);

      const existing = lessonProgressMap.get(lesson.id);
      const completedAt = isCompleted ? (existing?.completed ? existing.completedAt : now) : null;
      lessonCompletedAtMap.set(lesson.id, completedAt);

      await client.lessonProgress.upsert({
        where: { studentId_lessonId: { studentId, lessonId: lesson.id } },
        create: { studentId, lessonId: lesson.id, completed: isCompleted, completedAt },
        update: { completed: isCompleted, completedAt }
      });
    }
  }

  // 6. Roll up MODULE Progress
  for (const mod of course.modules) {
    const moduleContents = mod.contents;
    const moduleQuizzes = mod.quizzes;
    const moduleAssignments = mod.assignments;
    const applicableLessons = mod.lessons.filter((l) => lessonHasApplicableItemsMap.get(l.id) === true);

    const hasDirectItemsOrLessons = (moduleContents.length + moduleQuizzes.length + moduleAssignments.length + applicableLessons.length) > 0;
    moduleHasApplicableItemsMap.set(mod.id, hasDirectItemsOrLessons);

    const directContentsCompleted = moduleContents.every((c) => completedContentSet.has(c.id));
    const directQuizzesCompleted = moduleQuizzes.every((q) => completedQuizSet.has(q.id));
    const directAssignmentsCompleted = moduleAssignments.every((a) => completedAssignmentSet.has(a.id));
    const lessonsCompleted = applicableLessons.every((l) => lessonCompletionStatus.get(l.id) === true);

    const isCompleted = hasDirectItemsOrLessons && directContentsCompleted && directQuizzesCompleted && directAssignmentsCompleted && lessonsCompleted;
    moduleCompletionStatus.set(mod.id, isCompleted);

    const existing = moduleProgressMap.get(mod.id);
    const completedAt = isCompleted ? (existing?.completed ? existing.completedAt : now) : null;
    moduleCompletedAtMap.set(mod.id, completedAt);

    await client.moduleProgress.upsert({
      where: { studentId_moduleId: { studentId, moduleId: mod.id } },
      create: { studentId, moduleId: mod.id, completed: isCompleted, completedAt },
      update: { completed: isCompleted, completedAt }
    });
  }

  // 7. Roll up COURSE / ENROLLMENT Progress
  const totalPublishedItems = allContentIds.size + allQuizMap.size + allAssignmentIds.size;

  let completedItemsCount = 0;
  allContentIds.forEach((id) => { if (completedContentSet.has(id)) completedItemsCount++; });
  allQuizMap.forEach((_, id) => { if (completedQuizSet.has(id)) completedItemsCount++; });
  allAssignmentIds.forEach((id) => { if (completedAssignmentSet.has(id)) completedItemsCount++; });

  const progressPercent = totalPublishedItems > 0 ? Math.round((completedItemsCount / totalPublishedItems) * 100) : 0;
  const isCourseCompleted = totalPublishedItems > 0 && completedItemsCount === totalPublishedItems;

  const existingEnrollment = await client.enrollment.findUnique({
    where: { studentId_courseId: { studentId, courseId } }
  });

  if (existingEnrollment) {
    const courseCompletedAt = isCourseCompleted
      ? (existingEnrollment.completed ? existingEnrollment.completedAt : now)
      : null;

    await client.enrollment.update({
      where: { id: existingEnrollment.id },
      data: {
        progressPercent,
        completed: isCourseCompleted,
        completedAt: courseCompletedAt,
        lastAccessedAt: now
      }
    });
  }

  const result = {
    courseId,
    studentId,
    totalItems: totalPublishedItems,
    completedItems: completedItemsCount,
    progressPercent,
    completed: isCourseCompleted
  };

  if (!includeTree) return result;

  // 8. Build the authoritative hierarchical progress tree from the SAME
  //    applicable-item set the percentages above were derived from.
  const mapContent = (c) => ({
    id: c.id,
    kind: 'CONTENT',
    title: c.title,
    contentType: c.type,
    order: c.order,
    duration: c.duration,
    completed: completedContentSet.has(c.id),
    completedAt: contentProgressMap.get(c.id)?.completedAt ?? null
  });

  const mapQuiz = (q) => {
    const sub = quizSubmissionMap.get(q.id) || null;
    return {
      id: q.id,
      kind: 'QUIZ',
      title: q.title,
      order: q.order,
      passingScore: q.passingScore,
      completed: completedQuizSet.has(q.id),
      attempted: !!sub,
      score: sub?.score ?? null,
      totalMarks: sub?.totalMarks ?? null,
      percentage: sub?.percentage ?? null,
      passed: sub?.passed ?? null,
      submittedAt: sub?.submittedAt ?? null
    };
  };

  const mapAssignment = (a) => {
    const sub = assignmentSubmissionMap.get(a.id) || null;
    return {
      id: a.id,
      kind: 'ASSIGNMENT',
      title: a.title,
      dueDate: a.dueDate,
      completed: completedAssignmentSet.has(a.id),
      submissionStatus: sub?.status ?? 'NotSubmitted',
      grade: sub?.grade ?? null,
      submittedAt: sub?.submittedAt ?? null
    };
  };

  // Direct (non-inherited) learning items owned by an entity, with their own counts.
  const buildDirect = (entity) => {
    const contents = entity.contents.map(mapContent);
    const quizzes = entity.quizzes.map(mapQuiz);
    const assignments = entity.assignments.map(mapAssignment);
    const items = [...contents, ...quizzes, ...assignments];
    return {
      contents,
      quizzes,
      assignments,
      directTotalItems: items.length,
      directCompletedItems: items.filter((i) => i.completed).length
    };
  };

  const pct = (completedCount, totalCount) =>
    totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  const modulesTree = course.modules.map((mod) => {
    const lessonsTree = mod.lessons.map((lesson) => {
      const topicsTree = lesson.topics.map((topic) => {
        const direct = buildDirect(topic);
        return {
          id: topic.id,
          title: topic.title,
          order: topic.order,
          ...direct,
          totalItems: direct.directTotalItems,
          completedItems: direct.directCompletedItems,
          progressPercent: pct(direct.directCompletedItems, direct.directTotalItems),
          applicable: topicHasApplicableItemsMap.get(topic.id) === true,
          completed: topicCompletionStatus.get(topic.id) === true,
          completedAt: topicCompletedAtMap.get(topic.id) ?? null
        };
      });

      const direct = buildDirect(lesson);
      const totalItems = direct.directTotalItems + topicsTree.reduce((s, t) => s + t.totalItems, 0);
      const completedItems = direct.directCompletedItems + topicsTree.reduce((s, t) => s + t.completedItems, 0);

      return {
        id: lesson.id,
        title: lesson.title,
        order: lesson.order,
        ...direct,
        topics: topicsTree,
        totalItems,
        completedItems,
        progressPercent: pct(completedItems, totalItems),
        applicable: lessonHasApplicableItemsMap.get(lesson.id) === true,
        completed: lessonCompletionStatus.get(lesson.id) === true,
        completedAt: lessonCompletedAtMap.get(lesson.id) ?? null
      };
    });

    const direct = buildDirect(mod);
    const totalItems = direct.directTotalItems + lessonsTree.reduce((s, l) => s + l.totalItems, 0);
    const completedItems = direct.directCompletedItems + lessonsTree.reduce((s, l) => s + l.completedItems, 0);

    return {
      id: mod.id,
      title: mod.title,
      order: mod.order,
      ...direct,
      lessons: lessonsTree,
      totalItems,
      completedItems,
      progressPercent: pct(completedItems, totalItems),
      applicable: moduleHasApplicableItemsMap.get(mod.id) === true,
      completed: moduleCompletionStatus.get(mod.id) === true,
      completedAt: moduleCompletedAtMap.get(mod.id) ?? null
    };
  });

  const courseDirect = buildDirect(course);

  result.hierarchy = {
    id: course.id,
    title: course.title,
    status: course.status,
    ...courseDirect,
    modules: modulesTree,
    totalItems: totalPublishedItems,
    completedItems: completedItemsCount,
    progressPercent,
    completed: isCourseCompleted
  };

  return result;
}

/**
 * Ensures progress is initialized and computed.
 */
async function ensureProgressInitialized(studentId, courseId, tx = null) {
  return recomputeCourseProgress(studentId, courseId, tx);
}

module.exports = {
  recomputeCourseProgress,
  ensureProgressInitialized
};
