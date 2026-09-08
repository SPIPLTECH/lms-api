const prisma = require('../../config/database');
const { recomputeCourseProgress, ensureProgressInitialized } = require('../../utils/progressRollup');

/**
 * Marks a single Content item as complete/incomplete for a student
 * and triggers bottom-up course progress rollup.
 */
async function completeContent(studentId, contentId, completed = true) {
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

  const now = new Date();
  await prisma.contentProgress.upsert({
    where: { studentId_contentId: { studentId, contentId } },
    create: { studentId, contentId, completed, completedAt: completed ? now : null },
    update: { completed, completedAt: completed ? now : null }
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
async function completeLesson(studentId, lessonId, completed = true) {
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
 * Retrieves detailed progress for a student in a specific course.
 */
async function getStudentCourseProgress(studentId, courseId) {
  const rollup = await recomputeCourseProgress(studentId, courseId);

  const topicProgresses = await prisma.topicProgress.findMany({
    where: { studentId }
  });
  const lessonProgresses = await prisma.lessonProgress.findMany({
    where: { studentId }
  });
  const moduleProgresses = await prisma.moduleProgress.findMany({
    where: { studentId }
  });
  const contentProgresses = await prisma.contentProgress.findMany({
    where: { studentId }
  });
  const quizSubmissions = await prisma.quizSubmission.findMany({
    where: { studentId }
  });
  const assignmentSubmissions = await prisma.assignmentSubmission.findMany({
    where: { studentId, status: { in: ['Submitted', 'Graded'] } }
  });

  return {
    ...rollup,
    topicProgresses: topicProgresses.filter((tp) => tp.completed).map((tp) => tp.topicId),
    lessonProgresses: lessonProgresses.filter((lp) => lp.completed).map((lp) => lp.lessonId),
    moduleProgresses: moduleProgresses.filter((mp) => mp.completed).map((mp) => mp.moduleId),
    completedContentIds: contentProgresses.filter((cp) => cp.completed).map((cp) => cp.contentId),
    completedQuizIds: quizSubmissions.filter((qs) => qs.passed).map((qs) => qs.quizId),
    completedAssignmentIds: assignmentSubmissions.map((as) => as.assignmentId)
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

  const results = [];
  for (const enc of enrollments) {
    const rollup = await recomputeCourseProgress(studentId, enc.courseId);
    results.push({
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
    });
  }

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
  completeContent,
  completeLesson,
  getStudentCourseProgress,
  getStudentOverallProgress,
  getInstructorCourseProgress,
  ensureProgressInitialized
};
