const prisma = require('../../config/database');
const progressService = require('./progress.service');

/**
 * Resolves the StudentProfile id whose progress this request may read.
 *
 * A STUDENT is always resolved strictly from their own authenticated userId --
 * never from a caller-supplied id, and never by treating their User id as a
 * StudentProfile id, which would let an id collision across those two id spaces
 * surface another student's progress. Only INSTRUCTOR/ADMIN may target another
 * student, and those routes are additionally course-ownership checked.
 */
async function resolveStudentId(req) {
  const role = req.user?.role;
  const isPrivileged = role === 'INSTRUCTOR' || role === 'ADMIN';
  const requestedId = req.query?.studentId || req.params?.studentId;

  if (isPrivileged && requestedId) {
    const profileById = await prisma.studentProfile.findUnique({
      where: { id: requestedId }
    });
    if (profileById) return profileById.id;

    const profileByUserId = await prisma.studentProfile.findUnique({
      where: { userId: requestedId }
    });
    if (profileByUserId) return profileByUserId.id;
  } else if (req.user?.id) {
    const ownProfile = await prisma.studentProfile.findUnique({
      where: { userId: req.user.id }
    });
    if (ownProfile) return ownProfile.id;
  }

  const error = new Error('Student profile not found');
  error.statusCode = 404;
  throw error;
}

async function markContentComplete(req, res, next) {
  try {
    const studentId = await resolveStudentId(req);
    const { contentId, contentIds, completed = true } = req.body;
    const data = await progressService.completeContent(
      studentId,
      Array.isArray(contentIds) && contentIds.length > 0 ? contentIds : contentId,
      completed,
      req.user
    );
    res.json({
      success: true,
      message: completed ? 'Content marked as complete' : 'Content marked as incomplete',
      data
    });
  } catch (error) {
    next(error);
  }
}

async function markLessonComplete(req, res, next) {
  try {
    const studentId = await resolveStudentId(req);
    const { lessonId, completed = true } = req.body;
    const data = await progressService.completeLesson(studentId, lessonId, completed, req.user);
    res.json({
      success: true,
      message: completed ? 'Lesson marked as complete' : 'Lesson marked as incomplete',
      data
    });
  } catch (error) {
    next(error);
  }
}

async function markVisited(req, res, next) {
  try {
    const studentId = await resolveStudentId(req);
    const { visited = true } = req.body;
    const data = await progressService.markVisited(studentId, req.body, visited, req.user);
    res.json({
      success: true,
      message: visited ? 'Marked as visited' : 'Marked as unvisited',
      data
    });
  } catch (error) {
    next(error);
  }
}

async function getCourseProgress(req, res, next) {
  try {
    const studentId = await resolveStudentId(req);
    const { courseId } = req.params;
    await progressService.assertCourseProgressAccess(req.user, studentId, courseId);
    const data = await progressService.getStudentCourseProgress(studentId, courseId);
    res.json({
      success: true,
      data
    });
  } catch (error) {
    next(error);
  }
}

async function getOverallProgress(req, res, next) {
  try {
    const studentId = await resolveStudentId(req);
    const data = await progressService.getStudentOverallProgress(studentId);
    res.json({
      success: true,
      data
    });
  } catch (error) {
    next(error);
  }
}

async function getInstructorProgress(req, res, next) {
  try {
    const { courseId } = req.params;
    const data = await progressService.getInstructorCourseProgress(courseId);
    res.json({
      success: true,
      data
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /progress/learning-path?courseId=<id>[&studentId=<id>]
 *
 * The ordered path through one course: what is done, what is skipped after
 * qualifying, what is open now, and what is still locked — plus the
 * qualifying test on offer where one exists. The course is a query parameter
 * rather than a path segment so the resource stays flat and the same handler
 * serves an instructor inspecting a student (studentId, ownership-checked by
 * the same guard the progress tree uses).
 *
 * Responds with the array itself under `data`, with the derived pointers
 * alongside it — a list endpoint returns a list.
 */
async function getLearningPath(req, res, next) {
  try {
    const studentId = await resolveStudentId(req);
    const courseId = req.query?.courseId;

    if (!courseId) {
      return res.status(400).json({
        success: false,
        message: 'courseId is required'
      });
    }

    await progressService.assertCourseProgressAccess(req.user, studentId, courseId);
    const path = await progressService.getStudentLearningPath(studentId, courseId);

    res.json({
      success: true,
      data: path,
      // Derived from the same array, so a caller that only needs "where am I"
      // doesn't have to scan it and can't disagree with it.
      nextItem: progressService.resolveNextItem(path),
      lockedCount: path.filter((entry) => entry.locked).length,
      skippableCount: path.filter((entry) => entry.skippable).length
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  markContentComplete,
  markLessonComplete,
  markVisited,
  getCourseProgress,
  getLearningPath,
  getOverallProgress,
  getInstructorProgress
};
