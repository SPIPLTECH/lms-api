const learningPathService = require("./learningPath.service");

const getLearningPath = async (req, res, next) => {
  try {
    const studentId = req.params.studentId || req.query.studentId;
    const path = await learningPathService.getLearningPathByStudentId(studentId);

    return res.status(200).json({
      success: true,
      data: path,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getLearningPath,
};
