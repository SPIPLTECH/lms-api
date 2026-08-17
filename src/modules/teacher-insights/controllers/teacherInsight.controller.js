const teacherInsightService = require("../services/teacherInsight.service");
const { successResponse } = require("../../../utils/response");
const { resolveTargetTeacherId } = require("../utils/accessControl.util");

/** Controllers stay thin: resolve the target teacher/course, delegate, shape the response. */

const getByTeacher = async (req, res, next) => {
  try {
    const targetTeacherId = resolveTargetTeacherId(req.teacherInsightActor, req.params.teacherId);
    const result = await teacherInsightService.getTeacherDashboard(targetTeacherId);
    return successResponse(res, result, "Teacher insights fetched");
  } catch (error) {
    next(error);
  }
};

const getByCourse = async (req, res, next) => {
  try {
    const result = await teacherInsightService.getCourseDashboard(req.course.id);
    return successResponse(res, result, "Course insights fetched");
  } catch (error) {
    next(error);
  }
};

const getStudentsAtRisk = async (req, res, next) => {
  try {
    const result = await teacherInsightService.getStudentsAtRisk(req.course.id);
    return successResponse(res, result, "At-risk students fetched");
  } catch (error) {
    next(error);
  }
};

const getCourseHealth = async (req, res, next) => {
  try {
    const result = await teacherInsightService.getCourseHealth(req.course.id);
    return successResponse(res, result, "Course health fetched");
  } catch (error) {
    next(error);
  }
};

const getClassPerformance = async (req, res, next) => {
  try {
    const result = await teacherInsightService.getClassPerformance(req.course.id);
    return successResponse(res, result, "Class performance fetched");
  } catch (error) {
    next(error);
  }
};

const getRecommendations = async (req, res, next) => {
  try {
    const result = await teacherInsightService.getRecommendations(req.course.id);
    return successResponse(res, result, "Teaching recommendations fetched");
  } catch (error) {
    next(error);
  }
};

const getWeeklySummary = async (req, res, next) => {
  try {
    const result = await teacherInsightService.getWeeklySummary(req.course.id);
    return successResponse(res, result, "Weekly teaching summary fetched");
  } catch (error) {
    next(error);
  }
};

const getMonthlySummary = async (req, res, next) => {
  try {
    const result = await teacherInsightService.getMonthlySummary(req.course.id);
    return successResponse(res, result, "Monthly teaching report fetched");
  } catch (error) {
    next(error);
  }
};

const recalculate = async (req, res, next) => {
  try {
    const result = await teacherInsightService.recalculate(req.course.id);
    return successResponse(res, result, "Teacher insights recalculated");
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getByTeacher,
  getByCourse,
  getStudentsAtRisk,
  getCourseHealth,
  getClassPerformance,
  getRecommendations,
  getWeeklySummary,
  getMonthlySummary,
  recalculate,
};
