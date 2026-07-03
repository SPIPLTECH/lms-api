const courseService = require("./course.service");

const getCourses = async (req, res) => {
  try {
    const search = req.query.search || "";
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;

    const courses = await courseService.getCourses(
      req.user.role,
      search,
      page,
      limit
    );

    res.status(200).json({
      success: true,
      data: courses
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};
const getCourseById = async (
  req,
  res,
  next
) => {
  try {
    const course =
      await courseService.getCourseById(
        req.params.courseId
      );

    if (!course) {
      return res.status(404).json({
        message: "Course not found"
      });
    }

    res.json(course);
  } catch (error) {
    next(error);
  }
};
const createCourse = async (
  req,
  res,
  next
) => {
  try {
    const course =
      await courseService.createCourse(
        req.body,
        req.user.id
      );

    res.status(201).json(course);
  } catch (error) {
    next(error);
  }
};

const updateCourse = async (
  req,
  res,
  next
) => {
  try {
    const course =
      await courseService.updateCourse(
        req.params.courseId,
        req.body
      );

    res.json(course);
  } catch (error) {
    next(error);
  }
};

const updateStatus = async (
  req,
  res,
  next
) => {
  try {
    const course =
      await courseService.updateStatus(
        req.params.courseId,
        req.body.status
      );

    res.json(course);
  } catch (error) {
    next(error);
  }
};

const deleteCourse = async (
  req,
  res,
  next
) => {
  try {
    await courseService.deleteCourse(
      req.params.courseId
    );

    res.status(204).send();
  } catch (error) {
    next(error);
  }
};
const getCourseStudents = async (
  req,
  res,
  next
) => {
  try {
    const students =
      await courseService.getCourseStudents(
        req.params.courseId
      );

    res.json(students);
  } catch (error) {
    next(error);
  }
};
module.exports = {
  getCourses,
  getCourseById,
  createCourse,
  updateCourse,
  updateStatus,
  deleteCourse,
  getCourseStudents 
};