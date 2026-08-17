const studentCourseStateService = require("./studentCourseState.service");

const getCourseState = async (req, res, next) => {
  try {
    const { courseId } = req.params;
    const state = await studentCourseStateService.getCourseState(req.user.id, courseId);
    res.json({
      success: true,
      data: state || null
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getCourseState
};
