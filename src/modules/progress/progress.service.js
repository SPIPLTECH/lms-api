const prisma = require('../../config/database');
const { recomputeCourseProgress, ensureProgressInitialized } = require('../../utils/progressRollup');

/**
 * Marks a single Content item as complete/incomplete for a student
 * and triggers bottom-up course progress rollup.
 *
 * When `requestingUser` is supplied (always, from the HTTP layer) the caller's
 * access to the owning course is verified before any progress row is written,
 * so an unenrolled student cannot seed progress rows for a course.
 */
async function completeContent(studentId, contentId, completed = true, requestingUser = null) {
  const content = await prisma.content.findUnique({
    where: { id: contentId },
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
  });

  if (!content) {
    const error = new Error('Content not found');
    error.statusCode = 404;
    throw error;
  }

  const courseId =
    content.topic?.lesson?.module?.courseId ||
    content.lesson?.module?.courseId ||
    content.module?.courseId ||
    content.courseId;

  if (requestingUser && courseId) {
    await assertCourseProgressAccess(requestingUser, studentId, courseId);
  }

  const existing = await prisma.contentProgress.findUnique({
    where: { studentId_contentId: { studentId, contentId } }
  });
  const now = new Date();
  const completedAt = completed ? (existing?.completed && existing?.completedAt ? existing.completedAt : now) : null;

  await prisma.contentProgress.upsert({
    where: { studentId_contentId: { studentId, contentId } },
    create: { studentId, contentId, completed, completedAt: completed ? now : null },
    update: { completed, completedAt }
  });

  let rollup = null;
  if (courseId) {
    rollup = await recomputeCourseProgress(studentId, courseId);
  }

  return {
    contentId,
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

  const now = new Date();
  for (const cId of contentIds) {
    await prisma.contentProgress.upsert({
      where: { studentId_contentId: { studentId, contentId: cId } },
      create: { studentId, contentId: cId, completed, completedAt: completed ? now : null },
      update: { completed, completedAt: completed ? now : null }
    });
  }

  const rollup = await recomputeCourseProgress(studentId, courseId);

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
  const now = new Date();

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

    await prisma.contentProgress.upsert({
      where: { studentId_contentId: { studentId, contentId: entityId } },
      create: { studentId, contentId: entityId, visited, visitedAt: visited ? now : null },
      update: { visited, visitedAt: visited ? now : null }
    });
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

    await prisma.quizProgress.upsert({
      where: { studentId_quizId: { studentId, quizId: entityId } },
      create: { studentId, quizId: entityId, visited, visitedAt: visited ? now : null },
      update: { visited, visitedAt: visited ? now : null }
    });
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

    await prisma.assignmentProgress.upsert({
      where: { studentId_assignmentId: { studentId, assignmentId: entityId } },
      create: { studentId, assignmentId: entityId, visited, visitedAt: visited ? now : null },
      update: { visited, visitedAt: visited ? now : null }
    });
  } else if (entityType === 'TOPIC') {
    const topic = await prisma.topic.findUnique({
      where: { id: entityId },
      include: { lesson: { include: { module: true } } }
    });
    if (!topic) throw Object.assign(new Error('Topic not found'), { statusCode: 404 });
    courseId = topic.lesson.module.courseId;
    if (requestingUser && courseId) await assertCourseProgressAccess(requestingUser, studentId, courseId);

    await prisma.topicProgress.upsert({
      where: { studentId_topicId: { studentId, topicId: entityId } },
      create: { studentId, topicId: entityId, visited, visitedAt: visited ? now : null },
      update: { visited, visitedAt: visited ? now : null }
    });
  } else if (entityType === 'LESSON') {
    const lesson = await prisma.lesson.findUnique({
      where: { id: entityId },
      include: { module: true }
    });
    if (!lesson) throw Object.assign(new Error('Lesson not found'), { statusCode: 404 });
    courseId = lesson.module.courseId;
    if (requestingUser && courseId) await assertCourseProgressAccess(requestingUser, studentId, courseId);

    await prisma.lessonProgress.upsert({
      where: { studentId_lessonId: { studentId, lessonId: entityId } },
      create: { studentId, lessonId: entityId, visited, visitedAt: visited ? now : null },
      update: { visited, visitedAt: visited ? now : null }
    });
  } else if (entityType === 'MODULE') {
    const moduleItem = await prisma.module.findUnique({
      where: { id: entityId }
    });
    if (!moduleItem) throw Object.assign(new Error('Module not found'), { statusCode: 404 });
    courseId = moduleItem.courseId;
    if (requestingUser && courseId) await assertCourseProgressAccess(requestingUser, studentId, courseId);

    await prisma.moduleProgress.upsert({
      where: { studentId_moduleId: { studentId, moduleId: entityId } },
      create: { studentId, moduleId: entityId, visited, visitedAt: visited ? now : null },
      update: { visited, visitedAt: visited ? now : null }
    });
  } else {
    throw Object.assign(new Error('Invalid entity type for visited progress'), { statusCode: 400 });
  }

  let rollup = null;
  if (courseId) {
    rollup = await recomputeCourseProgress(studentId, courseId, null, { includeTree: true });
  }

  return {
    entityType,
    entityId,
    studentId,
    visited,
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
    // Flat convenience projections, scoped to this course.
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
    const rollup = await recomputeCourseProgress(enc.studentId, courseId);
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
