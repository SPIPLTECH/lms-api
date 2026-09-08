const prisma = require('../../config/database');
const progressService = require('./progress.service');

async function resolveStudentId(req) {
  let targetId = null;
  if ((req.user?.role === 'INSTRUCTOR' || req.user?.role === 'ADMIN') && (req.query?.studentId || req.params?.studentId)) {
    targetId = req.query.studentId || req.params.studentId;
  } else if (req.user?.studentProfile?.id) {
    return req.user.studentProfile.id;
  } else if (req.user?.id) {
    targetId = req.user.id;
  }

  if (targetId) {
    const profileById = await prisma.studentProfile.findUnique({
      where: { id: targetId }
    });
    if (profileById) return profileById.id;

    const profileByUserId = await prisma.studentProfile.findUnique({
      where: { userId: targetId }
    });
    if (profileByUserId) return profileByUserId.id;
  }

  const error = new Error('Student profile not found');
  error.statusCode = 404;
  throw error;
}

async function markContentComplete(req, res, next) {
  try {
    const studentId = await resolveStudentId(req);
    const { contentId, completed = true } = req.body;
    const data = await progressService.completeContent(studentId, contentId, completed);
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
    const data = await progressService.completeLesson(studentId, lessonId, completed);
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
