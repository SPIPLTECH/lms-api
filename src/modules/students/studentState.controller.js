const studentStateService = require("./studentState.service");

const getStudentState = async (req, res, next) => {
  try {
    const state = await studentStateService.getStudentState(req.user.id);
    res.json({
      success: true,
      data: state || null
    });
  } catch (error) {
    next(error);
  }
};

const updateStudentState = async (req, res, next) => {
  try {
    const state = await studentStateService.updateStudentState(req.user.id, req.body);
    res.json({
      success: true,
      message: "Student learning state saved successfully",
      data: state
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getStudentState,
  updateStudentState
};
