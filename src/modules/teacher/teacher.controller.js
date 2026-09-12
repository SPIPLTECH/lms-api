const teacherService = require("./teacher.service");

const getTeachers = async (req, res, next) => {
  try {
    const teachers = await teacherService.getTeachers();

    res.json({
      success: true,
      data: teachers
    });
  } catch (error) {
    next(error);
  }
};

const getTeacherById = async (req, res, next) => {
  try {
    const teacher = await teacherService.getTeacherById(
      req.params.teacherId
    );

    res.json({
      success: true,
      data: teacher
    });
  } catch (error) {
    next(error);
  }
};

const updateTeacher = async (req, res, next) => {
  try {
    const teacher = await teacherService.updateTeacher(
      req.params.teacherId,
      req.body
    );

    res.json({
      success: true,
      message: "Teacher updated successfully",
      data: teacher
    });
  } catch (error) {
    next(error);
  }
};

const getTeacherCourses = async (req, res, next) => {
  try {
    const courses = await teacherService.getTeacherCourses(
      req.params.teacherId
    );

    res.json({
      success: true,
      data: courses
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getTeachers,
  getTeacherById,
  updateTeacher,
  getTeacherCourses
};

