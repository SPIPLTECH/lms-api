const careerService = require("../services/career.service");
const { successResponse } = require("../../../utils/response");
const { resolveTargetStudentId } = require("../utils/accessControl.util");

/** Controllers stay thin: resolve the target student, delegate, shape the response. */

const getProfile = async (req, res, next) => {
  try {
    const studentId = resolveTargetStudentId(req.careerActor, req.params.studentId);
    const result = await careerService.getProfile(studentId);
    return successResponse(res, result, "Career profile fetched");
  } catch (error) {
    next(error);
  }
};

const getReadiness = async (req, res, next) => {
  try {
    const studentId = resolveTargetStudentId(req.careerActor, req.query.studentId);
    const result = await careerService.getReadiness(studentId);
    return successResponse(res, result, "Career readiness fetched");
  } catch (error) {
    next(error);
  }
};

const getRoles = async (req, res, next) => {
  try {
    const studentId = resolveTargetStudentId(req.careerActor, req.query.studentId);
    const result = await careerService.getRoles(studentId);
    return successResponse(res, result, "Recommended career roles fetched");
  } catch (error) {
    next(error);
  }
};

const getRoadmap = async (req, res, next) => {
  try {
    const studentId = resolveTargetStudentId(req.careerActor, req.query.studentId);
    const result = await careerService.getRoadmap(studentId, req.query.horizon);
    return successResponse(res, result, "Career roadmap fetched");
  } catch (error) {
    next(error);
  }
};

const getSkillGaps = async (req, res, next) => {
  try {
    const studentId = resolveTargetStudentId(req.careerActor, req.query.studentId);
    const result = await careerService.getSkillGaps(studentId);
    return successResponse(res, result, "Skill gaps fetched");
  } catch (error) {
    next(error);
  }
};

const getRecommendations = async (req, res, next) => {
  try {
    const studentId = resolveTargetStudentId(req.careerActor, req.query.studentId);
    const result = await careerService.getRecommendations(studentId, req.query.type);
    return successResponse(res, result, "Career recommendations fetched");
  } catch (error) {
    next(error);
  }
};

const getInterviewPlan = async (req, res, next) => {
  try {
    const studentId = resolveTargetStudentId(req.careerActor, req.query.studentId);
    const result = await careerService.getInterviewPlan(studentId);
    return successResponse(res, result, "Interview preparation plan fetched");
  } catch (error) {
    next(error);
  }
};

const recalculate = async (req, res, next) => {
  try {
    const studentId = resolveTargetStudentId(req.careerActor, req.body.studentId);
    const result = await careerService.recalculate(studentId);
    return successResponse(res, result, "Career profile recalculated");
  } catch (error) {
    next(error);
  }
};

const setGoal = async (req, res, next) => {
  try {
    const studentId = resolveTargetStudentId(req.careerActor, req.body.studentId);
    const { targetRoleId, targetRoleName, targetDate, notes } = req.body;
    const result = await careerService.setGoal(studentId, { targetRoleId, targetRoleName, targetDate, notes });
    return successResponse(res, result, "Career goal set");
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getProfile,
  getReadiness,
  getRoles,
  getRoadmap,
  getSkillGaps,
  getRecommendations,
  getInterviewPlan,
  recalculate,
  setGoal,
};
