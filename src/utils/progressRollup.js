const prisma = require('../config/database');
const { QUALIFYING_TAG, getCourseQualifications } = require('./qualification');

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
 * 2. Empty containers (0 applicable items/children) CANNOT complete or become visited (completed = false, visited = false)
 *    and are excluded from their parent's denominator so empty containers do not block completion.
 * 3. A parent container completes iff ALL applicable direct items AND ALL applicable child entities complete.
 * 4. Ground Truth Completions:
 *    - Content: ContentProgress row with completed = true
 *    - Quiz: QuizSubmission row with passed = true (or percentage >= passingScore)
 *    - Assignment: AssignmentSubmission row with status in ["Submitted", "Graded"]
 * 5. Ground Truth Visited:
 *    - Content: ContentProgress row with visited = true
 *    - Quiz: QuizProgress row with visited = true
 *    - Assignment: AssignmentProgress row with visited = true
 *    - Container (Topic/Lesson/Module/Course): explicitly marked visited OR all applicable children/items visited.
 * 6. Idempotent and transaction-aware. Preserves completedAt and visitedAt when remaining complete/visited.
 *
 * Pass `options.includeTree` to also receive the authoritative hierarchical progress
 * tree (Course -> Module -> Lesson -> Topic -> Content/Quiz/Assignment).
 *
 * Pass `options.persist: false` for a read-only computation (e.g. an
 * instructor viewing a student list): the same numbers and tree, but no
 * Topic/Lesson/Module progress rows are written and the enrollment is not
 * touched — so viewing never bumps a student's lastAccessedAt. Every level's
 * completion is computed from in-memory maps, so skipping the writes cannot
 * change the result.
 */
const ASSIGNMENT_COMPLETED_STATUSES = ['Submitted', 'Graded'];

function isAssignmentSubmissionComplete(submission) {
  return !!submission && ASSIGNMENT_COMPLETED_STATUSES.includes(submission.status);
}

async function computeCourseProgress(studentId, courseId, tx = null, options = {}) {
  const client = tx || prisma;
  const includeTree = options.includeTree === true;
  const persist = options.persist !== false;

  const contentSelect = { id: true, title: true, type: true, order: true, duration: true };
  const quizSelect = {
    id: true,
    title: true,
    order: true,
    passingScore: true,
    _count: {
      select: {
        questions: true,
        quizQuestions: true
      }
    }
  };
  const assignmentSelect = { id: true, title: true, dueDate: true };

  // A QUALIFYING quiz is the test that lets a student SKIP its lesson/topic,
  // not an item inside it. Counting it as required learning would mean a
  // topic could only be completed by passing the very test that exempts the
  // student from it — and a student who never intends to skip would be left
  // with a permanently incomplete topic. Every quiz lookup below therefore
  // filters it out; qualification is read separately, from the attempts.
  const GRADED_QUIZ_TAGS = { quizTag: { not: QUALIFYING_TAG } };

  // 1. Fetch live published hierarchy including direct Contents, Quizzes, Assignments at all levels
  const course = await client.course.findUnique({
    where: { id: courseId },
    select: {
      id: true,
      title: true,
      status: true,
      contents: {
        where: { moduleId: null, lessonId: null, topicId: null },
        orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
        select: contentSelect
      },
      quizzes: {
        where: { isPublished: true, moduleId: null, lessonId: null, topicId: null , ...GRADED_QUIZ_TAGS },
        orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
        select: quizSelect
      },
      assignments: {
        where: { isPublished: true, moduleId: null, lessonId: null, topicId: null },
        select: assignmentSelect
      },
      modules: {
        where: { isPublished: true },
        orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
        select: {
          id: true,
          title: true,
          order: true,
          contents: {
            where: { lessonId: null, topicId: null },
            orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
            select: contentSelect
          },
          quizzes: {
            where: { isPublished: true, lessonId: null, topicId: null , ...GRADED_QUIZ_TAGS },
            orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
            select: quizSelect
          },
          assignments: {
            where: { isPublished: true, lessonId: null, topicId: null },
            select: assignmentSelect
          },
          lessons: {
            where: { isPublished: true },
            orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
            select: {
              id: true,
              title: true,
              order: true,
              contents: {
                where: { topicId: null },
                orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
                select: contentSelect
              },
              quizzes: {
                where: { isPublished: true, topicId: null , ...GRADED_QUIZ_TAGS },
                orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
                select: quizSelect
              },
              assignments: {
                where: { isPublished: true, topicId: null },
                select: assignmentSelect
              },
              topics: {
                where: { isPublished: true },
                orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
                select: {
                  id: true,
                  title: true,
                  order: true,
                  contents: {
                    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
                    select: contentSelect
                  },
                  quizzes: {
                    where: { isPublished: true , ...GRADED_QUIZ_TAGS },
                    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
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
  // Container ids scope the existing-progress lookups below to this course
  // only, instead of every course the student has ever touched.
  const allTopicIds = new Set();
  const allLessonIds = new Set();
  const allModuleIds = new Set();

  // Course direct
  course.contents.forEach((c) => allContentIds.add(c.id));
  course.quizzes.forEach((q) => allQuizMap.set(q.id, q.passingScore));
  course.assignments.forEach((a) => allAssignmentIds.add(a.id));

  // Modules, Lessons, Topics
  for (const mod of course.modules) {
    allModuleIds.add(mod.id);
    mod.contents.forEach((c) => allContentIds.add(c.id));
    mod.quizzes.forEach((q) => allQuizMap.set(q.id, q.passingScore));
    mod.assignments.forEach((a) => allAssignmentIds.add(a.id));

    for (const lesson of mod.lessons) {
      allLessonIds.add(lesson.id);
      lesson.contents.forEach((c) => allContentIds.add(c.id));
      lesson.quizzes.forEach((q) => allQuizMap.set(q.id, q.passingScore));
      lesson.assignments.forEach((a) => allAssignmentIds.add(a.id));

      for (const topic of lesson.topics) {
        allTopicIds.add(topic.id);
        topic.contents.forEach((c) => allContentIds.add(c.id));
        topic.quizzes.forEach((q) => allQuizMap.set(q.id, q.passingScore));
        topic.assignments.forEach((a) => allAssignmentIds.add(a.id));
      }
    }
  }

  // 3. Fetch Ground Truth completions & visited states for Student, plus the
  // existing container-progress rows needed to preserve completedAt/visitedAt.
  // All eight lookups are independent of one another (each only depends on
  // the id sets collected in step 2), so they run as ONE parallel batch
  // instead of a chain of sequential round trips -- the dominant cost of a
  // rollup on a remote database is round-trip latency, not query cost, so
  // collapsing N sequential awaits into one Promise.all is the single
  // biggest lever on wall-clock time here.
  const quizIds = Array.from(allQuizMap.keys());
  const assignmentIds = Array.from(allAssignmentIds);
  const topicIds = Array.from(allTopicIds);
  const lessonIds = Array.from(allLessonIds);
  const moduleIds = Array.from(allModuleIds);

  const [
    cpRecords,
    qsRecords,
    qpRecords,
    asRecords,
    apRecords,
    existingTopicProgresses,
    existingLessonProgresses,
    existingModuleProgresses,
    qualifications
  ] = await Promise.all([
    allContentIds.size > 0
      ? client.contentProgress.findMany({
          where: { studentId, contentId: { in: Array.from(allContentIds) } },
          select: { contentId: true, completed: true, completedAt: true, visited: true, visitedAt: true }
        })
      : [],
    quizIds.length > 0
      ? client.quizSubmission.findMany({
          where: { studentId, quizId: { in: quizIds } },
          select: { quizId: true, passed: true, percentage: true, score: true, totalMarks: true, submittedAt: true }
        })
      : [],
    quizIds.length > 0
      ? client.quizProgress.findMany({
          where: { studentId, quizId: { in: quizIds } },
          select: { quizId: true, visited: true, visitedAt: true, completed: true, completedAt: true }
        })
      : [],
    assignmentIds.length > 0
      ? client.assignmentSubmission.findMany({
          where: { studentId, assignmentId: { in: assignmentIds } },
          select: { assignmentId: true, status: true, grade: true, submittedAt: true }
        })
      : [],
    assignmentIds.length > 0
      ? client.assignmentProgress.findMany({
          where: { studentId, assignmentId: { in: assignmentIds } },
          select: { assignmentId: true, visited: true, visitedAt: true, completed: true, completedAt: true }
        })
      : [],
    topicIds.length > 0
      ? client.topicProgress.findMany({
          where: { studentId, topicId: { in: topicIds } },
          select: { topicId: true, completed: true, completedAt: true, visited: true, visitedAt: true }
        })
      : [],
    lessonIds.length > 0
      ? client.lessonProgress.findMany({
          where: { studentId, lessonId: { in: lessonIds } },
          select: { lessonId: true, completed: true, completedAt: true, visited: true, visitedAt: true }
        })
      : [],
    moduleIds.length > 0
      ? client.moduleProgress.findMany({
          where: { studentId, moduleId: { in: moduleIds } },
          select: { moduleId: true, completed: true, completedAt: true, visited: true, visitedAt: true }
        })
      : [],
    // The lessons/topics this student has qualified out of, read from the
    // Phase 1 attempt log rather than stored anywhere of its own.
    getCourseQualifications(studentId, courseId, client)
  ]);

  const { qualifiedTopicIds, qualifiedLessonIds } = qualifications;

  // Qualification stands in for completion when deciding what a student may
  // move past, and counts toward the course percentage — otherwise a student
  // who legitimately skipped a lesson could never reach 100% or earn their
  // certificate. The two stay separate everywhere they are REPORTED (each
  // node carries its own `completed` and `qualified`), so "skipped after
  // qualifying" is never mistaken for "studied".
  const isTopicSatisfied = (topicId) =>
    topicCompletionStatus.get(topicId) === true || qualifiedTopicIds.has(topicId);
  const isLessonSatisfied = (lessonId) =>
    lessonCompletionStatus.get(lessonId) === true || qualifiedLessonIds.has(lessonId);

  // A. Content Progress
  const completedContentSet = new Set();
  const visitedContentSet = new Set();
  const contentProgressMap = new Map();
  cpRecords.forEach((r) => {
    contentProgressMap.set(r.contentId, r);
    if (r.completed) completedContentSet.add(r.contentId);
    if (r.visited) visitedContentSet.add(r.contentId);
  });

  // B. Quiz Progress & Submissions
  const completedQuizSet = new Set();
  const visitedQuizSet = new Set();
  const quizSubmissionMap = new Map();
  const quizProgressMap = new Map();
  qsRecords.forEach((qs) => {
    quizSubmissionMap.set(qs.quizId, qs);
    const minPassScore = allQuizMap.get(qs.quizId) || 0;
    if (qs.passed || (qs.percentage !== undefined && qs.percentage >= minPassScore)) {
      completedQuizSet.add(qs.quizId);
    }
  });
  qpRecords.forEach((qp) => {
    quizProgressMap.set(qp.quizId, qp);
    if (qp.visited) visitedQuizSet.add(qp.quizId);
    if (qp.completed) completedQuizSet.add(qp.quizId);
  });

  // C. Assignment Progress & Submissions
  const completedAssignmentSet = new Set();
  const visitedAssignmentSet = new Set();
  const assignmentSubmissionMap = new Map();
  const assignmentProgressMap = new Map();
  asRecords.forEach((r) => {
    assignmentSubmissionMap.set(r.assignmentId, r);
    if (isAssignmentSubmissionComplete(r)) completedAssignmentSet.add(r.assignmentId);
  });
  apRecords.forEach((ap) => {
    assignmentProgressMap.set(ap.assignmentId, ap);
    if (ap.visited) visitedAssignmentSet.add(ap.assignmentId);
    if (ap.completed) completedAssignmentSet.add(ap.assignmentId);
  });

  const topicProgressMap = new Map(existingTopicProgresses.map((tp) => [tp.topicId, tp]));
  const lessonProgressMap = new Map(existingLessonProgresses.map((lp) => [lp.lessonId, lp]));
  const moduleProgressMap = new Map(existingModuleProgresses.map((mp) => [mp.moduleId, mp]));

  const now = new Date();

  // In-memory status maps for bottom-up computation
  const topicCompletionStatus = new Map();
  const topicVisitedStatus = new Map();
  const topicHasApplicableItemsMap = new Map();
  const topicCompletedAtMap = new Map();
  const topicVisitedAtMap = new Map();

  const lessonCompletionStatus = new Map();
  const lessonVisitedStatus = new Map();
  const lessonHasApplicableItemsMap = new Map();
  const lessonCompletedAtMap = new Map();
  const lessonVisitedAtMap = new Map();

  const moduleCompletionStatus = new Map();
  const moduleVisitedStatus = new Map();
  const moduleHasApplicableItemsMap = new Map();
  const moduleCompletedAtMap = new Map();
  const moduleVisitedAtMap = new Map();

  // 4. Roll up TOPIC Progress
  // Every topic's completion depends only on its OWN contents/quizzes/
  // assignments (never on a sibling topic), so all topic upserts are
  // independent writes -- collected here and flushed with one Promise.all
  // instead of one awaited round trip per topic.
  const topicUpsertPromises = [];
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

        const contentsVisited = topicContents.every((c) => visitedContentSet.has(c.id));
        const quizzesVisited = topicQuizzes.every((q) => visitedQuizSet.has(q.id));
        const assignmentsVisited = topicAssignments.every((a) => visitedAssignmentSet.has(a.id));

        const existing = topicProgressMap.get(topic.id);

        const isCompleted = hasItems && contentsCompleted && quizzesCompleted && assignmentsCompleted;
        topicCompletionStatus.set(topic.id, isCompleted);
        const completedAt = isCompleted ? (existing?.completed ? existing.completedAt : now) : null;
        topicCompletedAtMap.set(topic.id, completedAt);

        const isVisited = existing?.visited || (hasItems && contentsVisited && quizzesVisited && assignmentsVisited);
        topicVisitedStatus.set(topic.id, isVisited);
        const visitedAt = isVisited ? (existing?.visited ? existing.visitedAt : now) : null;
        topicVisitedAtMap.set(topic.id, visitedAt);

        // Materialized from the qualifying attempts, exactly as `completed`
        // above is materialized from the topic's items. qualifiedAt is the
        // first passing attempt's timestamp, so it does not move when the
        // student retakes the test.
        const isQualified = qualifiedTopicIds.has(topic.id);
        const qualifiedAt = isQualified ? qualifiedTopicIds.get(topic.id) : null;

        if (persist) {
          topicUpsertPromises.push(
            client.topicProgress.upsert({
              where: { studentId_topicId: { studentId, topicId: topic.id } },
              create: { studentId, topicId: topic.id, completed: isCompleted, completedAt, visited: isVisited, visitedAt, qualified: isQualified, qualifiedAt },
              update: { completed: isCompleted, completedAt, visited: isVisited, visitedAt, qualified: isQualified, qualifiedAt }
            })
          );
        }
      }
    }
  }
  if (persist) await Promise.all(topicUpsertPromises);

  // 5. Roll up LESSON Progress -- same independence argument as topics: a
  // lesson's completion never depends on a sibling lesson, so these upserts
  // batch too. Must still run AFTER all topic upserts settle (already
  // guaranteed above) since lesson completion reads topicCompletionStatus.
  const lessonUpsertPromises = [];
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
      // A qualified topic no longer holds its lesson back: the student
      // demonstrated they already knew it.
      const topicsCompleted = applicableTopics.every((t) => isTopicSatisfied(t.id));

      const directContentsVisited = lessonContents.every((c) => visitedContentSet.has(c.id));
      const directQuizzesVisited = lessonQuizzes.every((q) => visitedQuizSet.has(q.id));
      const directAssignmentsVisited = lessonAssignments.every((a) => visitedAssignmentSet.has(a.id));
      const topicsVisited = applicableTopics.every((t) => topicVisitedStatus.get(t.id) === true);

      const existing = lessonProgressMap.get(lesson.id);

      const isCompleted = hasDirectItemsOrTopics && directContentsCompleted && directQuizzesCompleted && directAssignmentsCompleted && topicsCompleted;
      lessonCompletionStatus.set(lesson.id, isCompleted);
      const completedAt = isCompleted ? (existing?.completed ? existing.completedAt : now) : null;
      lessonCompletedAtMap.set(lesson.id, completedAt);

      const isVisited = existing?.visited || (hasDirectItemsOrTopics && directContentsVisited && directQuizzesVisited && directAssignmentsVisited && topicsVisited);
      lessonVisitedStatus.set(lesson.id, isVisited);
      const visitedAt = isVisited ? (existing?.visited ? existing.visitedAt : now) : null;
      lessonVisitedAtMap.set(lesson.id, visitedAt);

      const isQualified = qualifiedLessonIds.has(lesson.id);
      const qualifiedAt = isQualified ? qualifiedLessonIds.get(lesson.id) : null;

      if (persist) {
        lessonUpsertPromises.push(
          client.lessonProgress.upsert({
            where: { studentId_lessonId: { studentId, lessonId: lesson.id } },
            create: { studentId, lessonId: lesson.id, completed: isCompleted, completedAt, visited: isVisited, visitedAt, qualified: isQualified, qualifiedAt },
            update: { completed: isCompleted, completedAt, visited: isVisited, visitedAt, qualified: isQualified, qualifiedAt }
          })
        );
      }
    }
  }
  if (persist) await Promise.all(lessonUpsertPromises);

  // 6. Roll up MODULE Progress -- same batching, run after lessons settle
  // since module completion reads lessonCompletionStatus.
  const moduleUpsertPromises = [];
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
    // As with topics inside a lesson: a lesson the student qualified out of
    // does not hold its module back.
    const lessonsCompleted = applicableLessons.every((l) => isLessonSatisfied(l.id));

    const directContentsVisited = moduleContents.every((c) => visitedContentSet.has(c.id));
    const directQuizzesVisited = moduleQuizzes.every((q) => visitedQuizSet.has(q.id));
    const directAssignmentsVisited = moduleAssignments.every((a) => visitedAssignmentSet.has(a.id));
    const lessonsVisited = applicableLessons.every((l) => lessonVisitedStatus.get(l.id) === true);

    const existing = moduleProgressMap.get(mod.id);

    const isCompleted = hasDirectItemsOrLessons && directContentsCompleted && directQuizzesCompleted && directAssignmentsCompleted && lessonsCompleted;
    moduleCompletionStatus.set(mod.id, isCompleted);
    const completedAt = isCompleted ? (existing?.completed ? existing.completedAt : now) : null;
    moduleCompletedAtMap.set(mod.id, completedAt);

    const isVisited = existing?.visited || (hasDirectItemsOrLessons && directContentsVisited && directQuizzesVisited && directAssignmentsVisited && lessonsVisited);
    moduleVisitedStatus.set(mod.id, isVisited);
    const visitedAt = isVisited ? (existing?.visited ? existing.visitedAt : now) : null;
    moduleVisitedAtMap.set(mod.id, visitedAt);

    if (persist) {
      moduleUpsertPromises.push(
        client.moduleProgress.upsert({
          where: { studentId_moduleId: { studentId, moduleId: mod.id } },
          create: { studentId, moduleId: mod.id, completed: isCompleted, completedAt, visited: isVisited, visitedAt },
          update: { completed: isCompleted, completedAt, visited: isVisited, visitedAt }
        })
      );
    }
  }
  if (persist) await Promise.all(moduleUpsertPromises);

  // 7. Helper functions for mapping items and building direct item counts
  const mapContent = (c) => {
    const cp = contentProgressMap.get(c.id);
    return {
      id: c.id,
      kind: 'CONTENT',
      title: c.title,
      contentType: c.type,
      order: c.order,
      duration: c.duration,
      visited: visitedContentSet.has(c.id),
      visitedAt: cp?.visitedAt ?? null,
      completed: completedContentSet.has(c.id),
      completedAt: cp?.completedAt ?? null
    };
  };

  const mapQuiz = (q) => {
    const sub = quizSubmissionMap.get(q.id) || null;
    const qp = quizProgressMap.get(q.id) || null;
    const questionCount = (q._count?.questions || 0) + (q._count?.quizQuestions || 0);
    return {
      id: q.id,
      kind: 'QUIZ',
      title: q.title,
      order: q.order,
      passingScore: q.passingScore,
      questionCount,
      visited: visitedQuizSet.has(q.id),
      visitedAt: qp?.visitedAt ?? null,
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
    const ap = assignmentProgressMap.get(a.id) || null;
    return {
      id: a.id,
      kind: 'ASSIGNMENT',
      title: a.title,
      dueDate: a.dueDate,
      visited: visitedAssignmentSet.has(a.id),
      visitedAt: ap?.visitedAt ?? null,
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
      directCompletedItems: items.filter((i) => i.completed).length,
      directVisitedItems: items.filter((i) => i.visited).length
    };
  };

  const pct = (count, total) => (total > 0 ? Math.round((count / total) * 100) : 0);

  // 8. Build tree and roll up immediate-child denominators at every level:
  //    Parent Total Items = Direct Items + Immediate Applicable Child Containers
  //    Parent Completed Items = Direct Completed Items + Immediate Completed Child Containers
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
          visitedItems: direct.directVisitedItems,
          progressPercent: pct(direct.directCompletedItems, direct.directTotalItems),
          visitedPercent: pct(direct.directVisitedItems, direct.directTotalItems),
          applicable: topicHasApplicableItemsMap.get(topic.id) === true,
          completed: topicCompletionStatus.get(topic.id) === true,
          completedAt: topicCompletedAtMap.get(topic.id) ?? null,
          // Skipped after passing this topic's qualifying test. Reported
          // separately from `completed` so the player can say "skipped" and
          // not "done", while `satisfied` is the single flag progression
          // reads — no caller has to remember to check both.
          qualified: qualifiedTopicIds.has(topic.id),
          qualifiedAt: qualifiedTopicIds.get(topic.id) ?? null,
          satisfied: isTopicSatisfied(topic.id),
          visited: topicVisitedStatus.get(topic.id) === true,
          visitedAt: topicVisitedAtMap.get(topic.id) ?? null
        };
      });

      const direct = buildDirect(lesson);
      const applicableTopics = topicsTree.filter((t) => t.applicable);
      const totalItems = direct.directTotalItems + applicableTopics.length;
      const completedItems = direct.directCompletedItems + applicableTopics.filter((t) => t.satisfied).length;
      const visitedItems = direct.directVisitedItems + applicableTopics.filter((t) => t.visited).length;

      return {
        id: lesson.id,
        title: lesson.title,
        order: lesson.order,
        ...direct,
        topics: topicsTree,
        totalItems,
        completedItems,
        visitedItems,
        progressPercent: pct(completedItems, totalItems),
        visitedPercent: pct(visitedItems, totalItems),
        applicable: lessonHasApplicableItemsMap.get(lesson.id) === true,
        completed: lessonCompletionStatus.get(lesson.id) === true,
        completedAt: lessonCompletedAtMap.get(lesson.id) ?? null,
        qualified: qualifiedLessonIds.has(lesson.id),
        qualifiedAt: qualifiedLessonIds.get(lesson.id) ?? null,
        satisfied: isLessonSatisfied(lesson.id),
        visited: lessonVisitedStatus.get(lesson.id) === true,
        visitedAt: lessonVisitedAtMap.get(lesson.id) ?? null
      };
    });

    const direct = buildDirect(mod);
    const applicableLessons = lessonsTree.filter((l) => l.applicable);
    const totalItems = direct.directTotalItems + applicableLessons.length;
    const completedItems = direct.directCompletedItems + applicableLessons.filter((l) => l.satisfied).length;
    const visitedItems = direct.directVisitedItems + applicableLessons.filter((l) => l.visited).length;

    return {
      id: mod.id,
      title: mod.title,
      order: mod.order,
      ...direct,
      lessons: lessonsTree,
      totalItems,
      completedItems,
      visitedItems,
      progressPercent: pct(completedItems, totalItems),
      visitedPercent: pct(visitedItems, totalItems),
      applicable: moduleHasApplicableItemsMap.get(mod.id) === true,
      completed: moduleCompletionStatus.get(mod.id) === true,
      completedAt: moduleCompletedAtMap.get(mod.id) ?? null,
      // A module is never itself skippable — qualification is offered at
      // lesson and topic level only. Carried anyway so every node in the tree
      // answers the same three questions and callers need no special case.
      qualified: false,
      qualifiedAt: null,
      satisfied: moduleCompletionStatus.get(mod.id) === true,
      visited: moduleVisitedStatus.get(mod.id) === true,
      visitedAt: moduleVisitedAtMap.get(mod.id) ?? null
    };
  });

  const courseDirect = buildDirect(course);
  const applicableModules = modulesTree.filter((m) => m.applicable);
  const courseTotalItems = courseDirect.directTotalItems + applicableModules.length;
  const courseCompletedItems = courseDirect.directCompletedItems + applicableModules.filter((m) => m.completed).length;
  const courseVisitedItems = courseDirect.directVisitedItems + applicableModules.filter((m) => m.visited).length;

  const progressPercent = pct(courseCompletedItems, courseTotalItems);
  const visitedPercent = pct(courseVisitedItems, courseTotalItems);

  const isCourseCompleted = courseTotalItems > 0 && courseCompletedItems === courseTotalItems;
  const isCourseVisited = courseTotalItems > 0 && courseVisitedItems === courseTotalItems;

  const existingEnrollment = persist
    ? await client.enrollment.findUnique({
        where: { studentId_courseId: { studentId, courseId } }
      })
    : null;

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
    totalItems: courseTotalItems,
    completedItems: courseCompletedItems,
    progressPercent,
    completed: isCourseCompleted,
    visitedItems: courseVisitedItems,
    visitedPercent,
    visited: isCourseVisited
  };

  if (!includeTree) return result;

  result.hierarchy = {
    id: course.id,
    title: course.title,
    status: course.status,
    ...courseDirect,
    modules: modulesTree,
    totalItems: courseTotalItems,
    completedItems: courseCompletedItems,
    visitedItems: courseVisitedItems,
    progressPercent,
    visitedPercent,
    completed: isCourseCompleted,
    // A course is not skippable as a whole; carried for shape parity with
    // every other node in the tree.
    qualified: false,
    qualifiedAt: null,
    satisfied: isCourseCompleted,
    visited: isCourseVisited
  };

  return result;
}

/**
 * Serializes concurrent rollups for the same (studentId, courseId) pair.
 *
 * completeContent/markVisited/completeLesson can all be in flight for the
 * same student and course at once (e.g. the auto-visit fired when a block
 * opens racing the "Mark as Complete" click for that same block, or a
 * double-click before the mutation's own isPending guard commits). Each
 * call independently reads Content/Quiz/Assignment ground truth, computes
 * fresh Topic/Lesson/Module/Enrollment values, and writes them with no
 * shared transaction -- two overlapping calls can interleave their reads
 * and writes so that whichever call's write lands LAST wins the row, even
 * if it was computed from an OLDER snapshot (a classic lost update). Since
 * every one of these calls is independent, cheap, in-process bookkeeping
 * (no cross-request state, no I/O), a simple per-key promise chain is
 * enough to make them run one-at-a-time rather than interleaved, without
 * touching how any individual rollup is computed. Calls for different
 * students/courses never block each other.
 *
 * Only applies to the caller-owned-transaction-free path: a caller that
 * passes its own `tx` already controls its own sequencing.
 */
const rollupChains = new Map();

function runExclusive(key, fn) {
  const tail = rollupChains.get(key) || Promise.resolve();
  const settled = tail.then(fn, fn);
  const chained = settled.then(
    () => {},
    () => {}
  );
  rollupChains.set(key, chained);
  chained.finally(() => {
    if (rollupChains.get(key) === chained) rollupChains.delete(key);
  });
  return settled;
}

async function recomputeCourseProgress(studentId, courseId, tx = null, options = {}) {
  if (tx) return computeCourseProgress(studentId, courseId, tx, options);
  return runExclusive(`${studentId}:${courseId}`, () => computeCourseProgress(studentId, courseId, tx, options));
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

