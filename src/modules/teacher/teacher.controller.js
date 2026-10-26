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

module.exports = {
  getTeachers,
};

