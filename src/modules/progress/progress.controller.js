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
    const { contentId, completed = true } = req.body;
    const data = await progressService.completeContent(studentId, contentId, completed, req.user);
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

module.exports = {
  markContentComplete,
  markLessonComplete,
  getCourseProgress,
  getOverallProgress,
  getInstructorProgress
};
