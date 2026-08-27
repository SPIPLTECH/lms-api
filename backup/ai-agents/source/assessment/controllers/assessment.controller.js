const assessmentService = require("../services/assessment.service");
const { successResponse } = require("../../../utils/response");
const { resolveTargetStudentId } = require("../utils/accessControl.util");

/** Controllers stay thin: resolve the target student, delegate, shape the response. */

const getById = async (req, res, next) => {
  try {
    const targetStudentId = resolveTargetStudentId(req.assessmentActor, req.params.studentId);
    const state = await assessmentService.getFullState(targetStudentId);
    return successResponse(res, state, "Assessment state fetched");
  } catch (error) {
    next(error);
  }
};

const getMastery = async (req, res, next) => {
  try {
    const targetStudentId = resolveTargetStudentId(req.assessmentActor, req.query.studentId);
    const mastery = await assessmentService.getMastery(targetStudentId);
    return successResponse(res, mastery, "Concept mastery fetched");
  } catch (error) {
    next(error);
  }
};

const getHistory = async (req, res, next) => {
  try {
    const targetStudentId = resolveTargetStudentId(req.assessmentActor, req.query.studentId);
    const history = await assessmentService.getHistory(targetStudentId, {
      page: req.query.page,
      limit: req.query.limit,
    });
    return successResponse(res, history, "Assessment history fetched");
  } catch (error) {
    next(error);
  }
};

const getKnowledgeGaps = async (req, res, next) => {
  try {
    const targetStudentId = resolveTargetStudentId(req.assessmentActor, req.query.studentId);
    const gaps = await assessmentService.getKnowledgeGaps(targetStudentId);
    return successResponse(res, gaps, "Knowledge gaps fetched");
  } catch (error) {
    next(error);
  }
};

const getRecommendations = async (req, res, next) => {
  try {
    const targetStudentId = resolveTargetStudentId(req.assessmentActor, req.query.studentId);
    const recommendations = await assessmentService.getRecommendations(targetStudentId);
    return successResponse(res, recommendations, "Recommendations fetched");
  } catch (error) {
    next(error);
  }
};

const getReassessmentPlan = async (req, res, next) => {
  try {
    const targetStudentId = resolveTargetStudentId(req.assessmentActor, req.query.studentId);
    const plan = await assessmentService.getReassessmentPlan(targetStudentId);
    return successResponse(res, plan, "Reassessment plan fetched");
  } catch (error) {
    next(error);
  }
};

const evaluate = async (req, res, next) => {
  try {
    const targetStudentId = resolveTargetStudentId(req.assessmentActor, req.body.studentId);
    const result = await assessmentService.evaluateByEventId(req.body.eventId, targetStudentId);
    return successResponse(res, result, "Event evaluated", 201);
  } catch (error) {
    next(error);
  }
};

const recalculate = async (req, res, next) => {
  try {
    const targetStudentId = resolveTargetStudentId(req.assessmentActor, req.body.studentId);
    const result = await assessmentService.recalculate(targetStudentId);
    return successResponse(res, result, "Assessment state recalculated");
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getById,
  getMastery,
  getHistory,
  getKnowledgeGaps,
  getRecommendations,
  getReassessmentPlan,
  evaluate,
  recalculate,
};
