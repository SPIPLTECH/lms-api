const studentCourseStateService = require("../services/studentCourseState.service");
const { successResponse } = require("../../../utils/response");
const { resolveTargetStudentId } = require("../utils/accessControl.util");
const ApiError = require("../../../utils/ApiError");

const getCourseState = async (req, res, next) => {
  try {
    const targetStudentId = resolveTargetStudentId(req.actor, req.query.studentId);
    const state = await studentCourseStateService.getCourseState(targetStudentId, req.params.courseId);
    if (!state) throw new ApiError(404, "No AI entry-assessment baseline found for this student and course yet");
    return successResponse(res, state, "Course state fetched");
  } catch (error) {
    next(error);
  }
};

module.exports = { getCourseState };
