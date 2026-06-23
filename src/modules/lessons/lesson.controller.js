const lessonService = require("./lesson.service");

const getLessons = async (req, res, next) => {
  try {
    const { moduleId } = req.query;

    const lessons =
      await lessonService.getLessons(
        moduleId
      );

    res.json(lessons);
  } catch (error) {
    next(error);
  }
};

const getLessonById = async (
  req,
  res,
  next
) => {
  try {
    const lesson =
      await lessonService.getLessonById(
        req.params.lessonId
      );

    if (!lesson) {
      return res.status(404).json({
        message: "Lesson not found"
      });
    }

    res.json(lesson);
  } catch (error) {
    next(error);
  }
};

const createLesson = async (
  req,
  res,
  next
) => {
  try {
    const lesson =
      await lessonService.createLesson(
        req.body
      );

    res.status(201).json(lesson);
  } catch (error) {
    next(error);
  }
};

const updateLesson = async (
  req,
  res,
  next
) => {
  try {
    const lesson =
      await lessonService.updateLesson(
        req.params.lessonId,
        req.body
      );

    res.json(lesson);
  } catch (error) {
    next(error);
  }
};

const deleteLesson = async (
  req,
  res,
  next
) => {
  try {
    await lessonService.deleteLesson(
      req.params.lessonId
    );

    res.status(204).send();
  } catch (error) {
    next(error);
  }
};

const reorderLessons = async (
  req,
  res,
  next
) => {
  try {
    const result =
      await lessonService.reorderLessons(
        req.body.lessons
      );

    res.json(result);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getLessons,
  getLessonById,
  createLesson,
  updateLesson,
  deleteLesson,
  reorderLessons
};