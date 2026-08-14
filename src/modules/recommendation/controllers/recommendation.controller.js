const recommendationService = require("../services/recommendation.service");
const { successResponse } = require("../../../utils/response");
const { resolveTargetStudentId } = require("../utils/accessControl.util");

/** Controllers stay thin: resolve the target student, delegate, shape the response. */

const getById = async (req, res, next) => {
  try {
    const targetStudentId = resolveTargetStudentId(req.recommendationActor, req.params.studentId);
    const result = await recommendationService.getByStudent(targetStudentId);
    return successResponse(res, result, "Recommendations fetched");
  } catch (error) {
    next(error);
  }
};

const getToday = async (req, res, next) => {
  try {
    const targetStudentId = resolveTargetStudentId(req.recommendationActor, req.query.studentId);
    const result = await recommendationService.getToday(targetStudentId);
    return successResponse(res, result, "Today's recommendations fetched");
  } catch (error) {
    next(error);
  }
};

const getHighPriority = async (req, res, next) => {
  try {
    const targetStudentId = resolveTargetStudentId(req.recommendationActor, req.query.studentId);
    const result = await recommendationService.getHighPriority(targetStudentId);
    return successResponse(res, result, "High-priority recommendations fetched");
  } catch (error) {
    next(error);
  }
};

const getRevision = async (req, res, next) => {
  try {
    const targetStudentId = resolveTargetStudentId(req.recommendationActor, req.query.studentId);
    const result = await recommendationService.getRevision(targetStudentId);
    return successResponse(res, result, "Revision recommendations fetched");
  } catch (error) {
    next(error);
  }
};

const getLearning = async (req, res, next) => {
  try {
    const targetStudentId = resolveTargetStudentId(req.recommendationActor, req.query.studentId);
    const result = await recommendationService.getLearning(targetStudentId);
    return successResponse(res, result, "Learning recommendations fetched");
  } catch (error) {
    next(error);
  }
};

const recalculate = async (req, res, next) => {
  try {
    const targetStudentId = resolveTargetStudentId(req.recommendationActor, req.body.studentId);
    const result = await recommendationService.recalculate(targetStudentId);
    return successResponse(res, result, "Recommendations recalculated");
  } catch (error) {
    next(error);
  }
};

const feedback = async (req, res, next) => {
  try {
    const targetStudentId = resolveTargetStudentId(req.recommendationActor, req.body.studentId);
    const result = await recommendationService.recordFeedback(targetStudentId, {
      recommendationId: req.body.recommendationId,
      action: req.body.action,
      comment: req.body.comment,
    });
    return successResponse(res, result, "Feedback recorded", 201);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getById,
  getToday,
  getHighPriority,
  getRevision,
  getLearning,
  recalculate,
  feedback,
};
