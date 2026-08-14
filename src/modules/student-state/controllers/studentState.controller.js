const studentStateService = require("../services/studentState.service");
const studentCourseStateService = require("../services/studentCourseState.service");
const { successResponse } = require("../../../utils/response");
const { resolveTargetStudentId } = require("../utils/accessControl.util");
const ApiError = require("../../../utils/ApiError");

/** Controllers stay thin: resolve the target student, delegate, shape the response. */

const getById = async (req, res, next) => {
  try {
    const targetStudentId = resolveTargetStudentId(req.stateActor, req.params.studentId);
    const state = await studentStateService.getFullState(targetStudentId);
    return successResponse(res, state, "Student learning state fetched");
  } catch (error) {
    next(error);
  }
};

const getDashboard = async (req, res, next) => {
  try {
    const targetStudentId = resolveTargetStudentId(req.stateActor, req.query.studentId);
    const dashboard = await studentStateService.getDashboard(targetStudentId);
    return successResponse(res, dashboard, "Dashboard fetched");
  } catch (error) {
    next(error);
  }
};

const makeDomainHandler = (domain) => async (req, res, next) => {
  try {
    const targetStudentId = resolveTargetStudentId(req.stateActor, req.query.studentId);
    const slice = await studentStateService.getDomainSlice(targetStudentId, domain);
    return successResponse(res, slice, `${domain} fetched`);
  } catch (error) {
    next(error);
  }
};

const getCourseState = async (req, res, next) => {
  try {
    const targetStudentId = resolveTargetStudentId(req.stateActor, req.query.studentId);
    const state = await studentCourseStateService.getCourseState(targetStudentId, req.params.courseId);
    if (!state) throw new ApiError(404, "No AI entry-assessment baseline found for this student and course yet");
    return successResponse(res, state, "Course state fetched");
  } catch (error) {
    next(error);
  }
};

const recalculate = async (req, res, next) => {
  try {
    const targetStudentId = resolveTargetStudentId(req.stateActor, req.body.studentId);
    const result = await studentStateService.recalculate(targetStudentId);
    return successResponse(res, result, "Student learning state recalculated");
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getById,
  getDashboard,
  getProgress: makeDomainHandler("progress"),
  getPerformance: makeDomainHandler("performance"),
  getEngagement: makeDomainHandler("engagement"),
  getBehavior: makeDomainHandler("behavior"),
  getRisk: makeDomainHandler("risk"),
  getCourseState,
  recalculate,
};
