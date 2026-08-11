const learningPathService = require("../services/learningPath.service");
const { successResponse } = require("../../../utils/response");
const { resolveTargetStudentId } = require("../utils/accessControl.util");

/** Controllers stay thin: resolve the target student, delegate, shape the response. */

const getProfile = async (req, res, next) => {
  try {
    const studentId = resolveTargetStudentId(req.learningPathActor, req.params.studentId);
    const result = await learningPathService.getProfile(studentId);
    return successResponse(res, result, "Learning path fetched");
  } catch (error) {
    next(error);
  }
};

const getNext = async (req, res, next) => {
  try {
    const studentId = resolveTargetStudentId(req.learningPathActor, req.query.studentId);
    const result = await learningPathService.getNext(studentId);
    return successResponse(res, result, "Next lesson fetched");
  } catch (error) {
    next(error);
  }
};

const getDailyPlan = async (req, res, next) => {
  try {
    const studentId = resolveTargetStudentId(req.learningPathActor, req.query.studentId);
    const result = await learningPathService.getDailyPlan(studentId);
    return successResponse(res, result, "Daily study plan fetched");
  } catch (error) {
    next(error);
  }
};

const getWeeklyPlan = async (req, res, next) => {
  try {
    const studentId = resolveTargetStudentId(req.learningPathActor, req.query.studentId);
    const result = await learningPathService.getWeeklyPlan(studentId);
    return successResponse(res, result, "Weekly study plan fetched");
  } catch (error) {
    next(error);
  }
};

const getRecommendations = async (req, res, next) => {
  try {
    const studentId = resolveTargetStudentId(req.learningPathActor, req.query.studentId);
    const result = await learningPathService.getRecommendations(studentId, req.query.type);
    return successResponse(res, result, "Learning path recommendations fetched");
  } catch (error) {
    next(error);
  }
};

const getMilestones = async (req, res, next) => {
  try {
    const studentId = resolveTargetStudentId(req.learningPathActor, req.query.studentId);
    const result = await learningPathService.getMilestones(studentId, req.query.courseId);
    return successResponse(res, result, "Learning milestones fetched");
  } catch (error) {
    next(error);
  }
};

const recalculate = async (req, res, next) => {
  try {
    const studentId = resolveTargetStudentId(req.learningPathActor, req.body.studentId);
    const result = await learningPathService.recalculate(studentId);
    return successResponse(res, result, "Learning path recalculated");
  } catch (error) {
    next(error);
  }
};

module.exports = { getProfile, getNext, getDailyPlan, getWeeklyPlan, getRecommendations, getMilestones, recalculate };
