const prisma = require('../config/database');

/**
 * Authoritative bottom-up multi-entity progress roll-up engine.
 *
 * Participated Entity Types:
 * - Content (direct at Course, Module, Lesson, Topic levels)
 * - Quiz (direct at Course, Module, Lesson, Topic levels)
 * - Assignment (direct at Course level)
 *
 * Rules:
 * 1. Only published, student-accessible items are counted.
 * 2. Empty containers (0 applicable items/children) CANNOT complete (completed = false)
 *    and are excluded from their parent's denominator so empty containers do not block completion.
 * 3. A parent container completes iff ALL applicable direct items AND ALL applicable child entities complete.
 * 4. Ground Truth Completions:
 *    - Content: ContentProgress row with completed = true
 *    - Quiz: QuizSubmission row with passed = true (or submission exists if passingScore is 0)
 *    - Assignment: AssignmentSubmission row with status in ["Submitted", "Graded"]
 * 5. Idempotent and transaction-aware. Preserves completedAt when remaining complete; updates or resets on status flip.
 */
async function recomputeCourseProgress(studentId, courseId, tx = null) {
  const client = tx || prisma;

  // 1. Fetch live published hierarchy including direct Contents, Quizzes, Assignments at all levels
  const course = await client.course.findUnique({
    where: { id: courseId },
    select: {
      id: true,
      contents: {
        where: { moduleId: null, lessonId: null, topicId: null },
        select: { id: true }
      },
      quizzes: {
        where: { isPublished: true, moduleId: null, lessonId: null, topicId: null },
        select: { id: true, passingScore: true }
      },
      assignments: {
        where: { isPublished: true },
        select: { id: true }
      },
      modules: {
        where: { isPublished: true },
        orderBy: { order: 'asc' },
        select: {
          id: true,
          contents: {
            where: { lessonId: null, topicId: null },
            select: { id: true }
          },
          quizzes: {
            where: { isPublished: true, lessonId: null, topicId: null },
            select: { id: true, passingScore: true }
          },
          lessons: {
            where: { isPublished: true },
            orderBy: { order: 'asc' },
            select: {
              id: true,
              contents: {
                where: { topicId: null },
                select: { id: true }
              },
              quizzes: {
                where: { isPublished: true, topicId: null },
                select: { id: true, passingScore: true }
              },
              topics: {
                where: { isPublished: true },
                orderBy: { order: 'asc' },
                select: {
                  id: true,
                  contents: {
                    select: { id: true }
                  },
                  quizzes: {
                    where: { isPublished: true },
                    select: { id: true, passingScore: true }
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

    for (const lesson of mod.lessons) {
      lesson.contents.forEach((c) => allContentIds.add(c.id));
      lesson.quizzes.forEach((q) => allQuizMap.set(q.id, q.passingScore));

      for (const topic of lesson.topics) {
        topic.contents.forEach((c) => allContentIds.add(c.id));
        topic.quizzes.forEach((q) => allQuizMap.set(q.id, q.passingScore));
      }
    }
  }

  // 3. Fetch Ground Truth completions for Student
  // A. Content Completions
  const completedContentSet = new Set();
  if (allContentIds.size > 0) {
    const cpRecords = await client.contentProgress.findMany({
      where: { studentId, contentId: { in: Array.from(allContentIds) }, completed: true },
      select: { contentId: true }
    });
    cpRecords.forEach((r) => completedContentSet.add(r.contentId));
  }

  // B. Quiz Completions (QuizSubmission with passed = true, or passingScore == 0)
  const completedQuizSet = new Set();
  if (allQuizMap.size > 0) {
    const qsRecords = await client.quizSubmission.findMany({
      where: { studentId, quizId: { in: Array.from(allQuizMap.keys()) } },
      select: { quizId: true, passed: true, percentage: true }
    });
    qsRecords.forEach((qs) => {
      const minPassScore = allQuizMap.get(qs.quizId) || 0;
      if (qs.passed || (qs.percentage !== undefined && qs.percentage >= minPassScore)) {
        completedQuizSet.add(qs.quizId);
      }
    });
  }

  // C. Assignment Completions (AssignmentSubmission)
  const completedAssignmentSet = new Set();
  if (allAssignmentIds.size > 0) {
    const asRecords = await client.assignmentSubmission.findMany({
      where: {
        studentId,
        assignmentId: { in: Array.from(allAssignmentIds) },
        status: { in: ['Submitted', 'Graded'] }
      },
      select: { assignmentId: true }
    });
    asRecords.forEach((r) => completedAssignmentSet.add(r.assignmentId));
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
  const lessonCompletionStatus = new Map();
  const lessonHasApplicableItemsMap = new Map();
  const moduleCompletionStatus = new Map();
  const moduleHasApplicableItemsMap = new Map();

  // 4. Roll up TOPIC Progress
  for (const mod of course.modules) {
    for (const lesson of mod.lessons) {
      for (const topic of lesson.topics) {
        const topicContents = topic.contents;
        const topicQuizzes = topic.quizzes;
        const hasItems = (topicContents.length + topicQuizzes.length) > 0;
        topicHasApplicableItemsMap.set(topic.id, hasItems);

        const contentsCompleted = topicContents.every((c) => completedContentSet.has(c.id));
        const quizzesCompleted = topicQuizzes.every((q) => completedQuizSet.has(q.id));

        const isCompleted = hasItems && contentsCompleted && quizzesCompleted;
        topicCompletionStatus.set(topic.id, isCompleted);

        const existing = topicProgressMap.get(topic.id);
        const completedAt = isCompleted ? (existing?.completed ? existing.completedAt : now) : null;

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
      const applicableTopics = lesson.topics.filter((t) => topicHasApplicableItemsMap.get(t.id) === true);

      const hasDirectItemsOrTopics = (lessonContents.length + lessonQuizzes.length + applicableTopics.length) > 0;
      lessonHasApplicableItemsMap.set(lesson.id, hasDirectItemsOrTopics);

      const directContentsCompleted = lessonContents.every((c) => completedContentSet.has(c.id));
      const directQuizzesCompleted = lessonQuizzes.every((q) => completedQuizSet.has(q.id));
      const topicsCompleted = applicableTopics.every((t) => topicCompletionStatus.get(t.id) === true);

      const isCompleted = hasDirectItemsOrTopics && directContentsCompleted && directQuizzesCompleted && topicsCompleted;
      lessonCompletionStatus.set(lesson.id, isCompleted);

      const existing = lessonProgressMap.get(lesson.id);
      const completedAt = isCompleted ? (existing?.completed ? existing.completedAt : now) : null;

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
    const applicableLessons = mod.lessons.filter((l) => lessonHasApplicableItemsMap.get(l.id) === true);

    const hasDirectItemsOrLessons = (moduleContents.length + moduleQuizzes.length + applicableLessons.length) > 0;
    moduleHasApplicableItemsMap.set(mod.id, hasDirectItemsOrLessons);

    const directContentsCompleted = moduleContents.every((c) => completedContentSet.has(c.id));
    const directQuizzesCompleted = moduleQuizzes.every((q) => completedQuizSet.has(q.id));
    const lessonsCompleted = applicableLessons.every((l) => lessonCompletionStatus.get(l.id) === true);

    const isCompleted = hasDirectItemsOrLessons && directContentsCompleted && directQuizzesCompleted && lessonsCompleted;
    moduleCompletionStatus.set(mod.id, isCompleted);

    const existing = moduleProgressMap.get(mod.id);
    const completedAt = isCompleted ? (existing?.completed ? existing.completedAt : now) : null;

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

  return {
    courseId,
    studentId,
    totalItems: totalPublishedItems,
    completedItems: completedItemsCount,
    progressPercent,
    completed: isCourseCompleted
  };
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
