const progressService = require(
  "./progress.service"
);

const completeLesson = async (
  req,
  res,
  next
) => {
  try {
    const progress =
      await progressService.completeLesson(
        req.user.id,
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

const getProgress = async (
  req,
  res,
  next
) => {
  try {
    const result =
      await progressService.getCourseProgress(
        req.user.id,
        req.query.courseId
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
  getProgress
};