const analyticsService = require("../services/analytics.service");
const { successResponse } = require("../../../utils/response");

/** Controllers stay thin: the access middleware has already resolved/authorized the scope, this just delegates and shapes the response. */

const getDashboard = async (req, res, next) => {
  try {
    const result = await analyticsService.getDashboard(req.analyticsActor);
    return successResponse(res, result, "Analytics dashboard fetched");
  } catch (error) {
    next(error);
  }
};

const getByStudent = async (req, res, next) => {
  try {
    const result = await analyticsService.getByStudent(req.params.studentId);
    return successResponse(res, result, "Student analytics fetched");
  } catch (error) {
    next(error);
  }
};

const getByInstructor = async (req, res, next) => {
  try {
    const result = await analyticsService.getByInstructor(req.params.instructorId);
    return successResponse(res, result, "Instructor analytics fetched");
  } catch (error) {
    next(error);
  }
};

const getByCourse = async (req, res, next) => {
  try {
    const result = await analyticsService.getByCourse(req.course.id);
    return successResponse(res, result, "Course analytics fetched");
  } catch (error) {
    next(error);
  }
};

const getPlatform = async (req, res, next) => {
  try {
    const result = await analyticsService.getPlatform();
    return successResponse(res, result, "Platform analytics fetched");
  } catch (error) {
    next(error);
  }
};

const getKPIs = async (req, res, next) => {
  try {
    const { scopeType, scopeId } = req.resolvedScope;
    const result = await analyticsService.getKPIs(scopeType, scopeId, req.query.metricKey);
    return successResponse(res, result, "KPIs fetched");
  } catch (error) {
    next(error);
  }
};

const getTrends = async (req, res, next) => {
  try {
    const { scopeType, scopeId } = req.resolvedScope;
    const result = await analyticsService.getTrends(scopeType, scopeId, req.query.metricKey);
    return successResponse(res, result, "Trends fetched");
  } catch (error) {
    next(error);
  }
};

const getForecast = async (req, res, next) => {
  try {
    const { scopeType, scopeId } = req.resolvedScope;
    const result = await analyticsService.getForecast(scopeType, scopeId, req.query.metricKey);
    return successResponse(res, result, "Forecast fetched");
  } catch (error) {
    next(error);
  }
};

const getReports = async (req, res, next) => {
  try {
    const result = await analyticsService.getReports(req.query.reportType);
    return successResponse(res, result, "Reports fetched");
  } catch (error) {
    next(error);
  }
};

const recalculate = async (req, res, next) => {
  try {
    const { scopeType, scopeId } = req.resolvedScope;
    const result = await analyticsService.recalculate(scopeType, scopeId);
    return successResponse(res, result, "Analytics recalculated");
  } catch (error) {
    next(error);
  }
};

const exportReport = async (req, res, next) => {
  try {
    const { reportId, reportType, format } = req.body;
    const { body, contentType, filename } = await analyticsService.exportReport({ reportId, reportType, format });

    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.status(200).send(body);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getDashboard,
  getByStudent,
  getByInstructor,
  getByCourse,
  getPlatform,
  getKPIs,
  getTrends,
  getForecast,
  getReports,
  recalculate,
  exportReport,
};
