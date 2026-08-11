const motivationService = require("../services/motivation.service");
const { successResponse } = require("../../../utils/response");
const { resolveTargetStudentId } = require("../utils/accessControl.util");

/** Controllers stay thin: resolve the target student, delegate, shape the response. */

const getById = async (req, res, next) => {
  try {
    const targetStudentId = resolveTargetStudentId(req.motivationActor, req.params.studentId);
    const result = await motivationService.getByStudent(targetStudentId);
    return successResponse(res, result, "Motivation state fetched");
  } catch (error) {
    next(error);
  }
};

const getReminders = async (req, res, next) => {
  try {
    const targetStudentId = resolveTargetStudentId(req.motivationActor, req.query.studentId);
    const result = await motivationService.getReminders(targetStudentId);
    return successResponse(res, result, "Reminder schedules fetched");
  } catch (error) {
    next(error);
  }
};

const getStreak = async (req, res, next) => {
  try {
    const targetStudentId = resolveTargetStudentId(req.motivationActor, req.query.studentId);
    const result = await motivationService.getStreak(targetStudentId);
    return successResponse(res, result, "Streak fetched");
  } catch (error) {
    next(error);
  }
};

const getActions = async (req, res, next) => {
  try {
    const targetStudentId = resolveTargetStudentId(req.motivationActor, req.query.studentId);
    const result = await motivationService.getActions(targetStudentId, { type: req.query.type, priority: req.query.priority });
    return successResponse(res, result, "Motivation actions fetched");
  } catch (error) {
    next(error);
  }
};

const getHistory = async (req, res, next) => {
  try {
    const targetStudentId = resolveTargetStudentId(req.motivationActor, req.query.studentId);
    const result = await motivationService.getHistory(targetStudentId, { page: req.query.page, limit: req.query.limit });
    return successResponse(res, result, "Motivation history fetched");
  } catch (error) {
    next(error);
  }
};

const recalculate = async (req, res, next) => {
  try {
    const targetStudentId = resolveTargetStudentId(req.motivationActor, req.body.studentId);
    const result = await motivationService.recalculate(targetStudentId);
    return successResponse(res, result, "Motivation state recalculated");
  } catch (error) {
    next(error);
  }
};

const acknowledge = async (req, res, next) => {
  try {
    const targetStudentId = resolveTargetStudentId(req.motivationActor, req.body.studentId);
    const result = await motivationService.acknowledge(targetStudentId, { motivationActionId: req.body.motivationActionId });
    return successResponse(res, result, "Motivation action acknowledged");
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getById,
  getReminders,
  getStreak,
  getActions,
  getHistory,
  recalculate,
  acknowledge,
};
