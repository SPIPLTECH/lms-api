const prisma = require("../../config/database");
const progressService = require(
  "./progress.service"
);

const completeLesson = async (
  req,
  res,
  next
) => {
  try {
    const student =
      await prisma.studentProfile.findUnique({
        where: {
          userId: req.user.id
        }
      });

    if (!student) {
      return res.status(404).json({
        success: false,
        message: "Student profile not found"
      });
    }

    const progress =
      await progressService.completeLesson(
        student.id,
        req.body.lessonId
      );

    res.status(201).json({
      success: true,
      data: progress
    });
  } catch (error) {
    next(error);
  }
};

const markContentVisited = async (
  req,
  res,
  next
) => {
  try {
    const student =
      await prisma.studentProfile.findUnique({
        where: {
          userId: req.user.id
        }
      });

    if (!student) {
      return res.status(404).json({
        success: false,
        message: "Student profile not found"
      });
    }

    const result =
      await progressService.markContentVisited(
        student.id,
        req.body.contentIds
      );

    res.status(200).json({
      success: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
};

const getProgress = async (
  req,
  res,
  next
) => {
  try {
    const student =
      await prisma.studentProfile.findUnique({
        where: {
          userId: req.user.id
        }
      });

    if (!student) {
      return res.status(404).json({
        success: false,
        message: "Student profile not found"
      });
    }

    const result = req.query.courseId
      ? await progressService.getCourseProgress(
          student.id,
          req.query.courseId
        )
      : await progressService.getAllCoursesProgress(
          student.id
        );

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  completeLesson,
  markContentVisited,
  getProgress
};