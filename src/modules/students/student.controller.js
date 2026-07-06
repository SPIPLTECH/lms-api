const studentService = require("./student.service");

const getStudents = async (req, res, next) => {
  try {
    const students = await studentService.getStudents();

    res.json({
      success: true,
      data: students
    });
  } catch (error) {
    next(error);
  }
};

const getStudentById = async (req, res, next) => {
  try {
    const student = await studentService.getStudentById(
      req.params.studentId
    );

    res.json({
      success: true,
      data: student
    });
  } catch (error) {
    next(error);
  }
};

const updateStudent = async (req, res, next) => {
  try {
    const student = await studentService.updateStudent(
      req.params.studentId,
      req.body
    );

    res.json({
      success: true,
      message: "Student updated successfully",
      data: student
    });
  } catch (error) {
    next(error);
  }
};

const getStudentProgress = async (req, res, next) => {
  try {
    const progress = await studentService.getStudentProgress(
      req.params.studentId
    );

    res.json({
      success: true,
      data: progress
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getStudents,
  getStudentById,
  updateStudent,
  getStudentProgress
};
