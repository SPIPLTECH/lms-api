const adminIntelligenceService = require("../services/adminIntelligence.service");
const { successResponse } = require("../../../utils/response");

/** Controllers stay thin: the access middleware has already gated ADMIN-only, this just delegates and shapes the response. */

const getDashboard = async (req, res, next) => {
  try {
    const result = await adminIntelligenceService.getDashboard();
    return successResponse(res, result, "Admin intelligence dashboard fetched");
  } catch (error) {
    next(error);
  }
};

const getInstitutionHealth = async (req, res, next) => {
  try {
    const result = await adminIntelligenceService.getInstitutionHealth();
    return successResponse(res, result, "Institution health fetched");
  } catch (error) {
    next(error);
  }
};

const getDepartments = async (req, res, next) => {
  try {
    const result = await adminIntelligenceService.getDepartments();
    return successResponse(res, result, "Department analytics fetched");
  } catch (error) {
    next(error);
  }
};

const getFaculty = async (req, res, next) => {
  try {
    const result = await adminIntelligenceService.getFaculty();
    return successResponse(res, result, "Faculty analytics fetched");
  } catch (error) {
    next(error);
  }
};

const getStudentRisk = async (req, res, next) => {
  try {
    const result = await adminIntelligenceService.getStudentRisk();
    return successResponse(res, result, "Student risk report fetched");
  } catch (error) {
    next(error);
  }
};

const getCompliance = async (req, res, next) => {
  try {
    const result = await adminIntelligenceService.getCompliance();
    return successResponse(res, result, "Compliance report fetched");
  } catch (error) {
    next(error);
  }
};

const getForecasts = async (req, res, next) => {
  try {
    const result = await adminIntelligenceService.getForecasts(req.query.resourceType);
    return successResponse(res, result, "Capacity forecasts fetched");
  } catch (error) {
    next(error);
  }
};

const getAlerts = async (req, res, next) => {
  try {
    const result = await adminIntelligenceService.getAlerts(req.query.priority);
    return successResponse(res, result, "Admin alerts fetched");
  } catch (error) {
    next(error);
  }
};

const getReports = async (req, res, next) => {
  try {
    const result = await adminIntelligenceService.getReports(req.query.reportType);
    return successResponse(res, result, "Executive reports fetched");
  } catch (error) {
    next(error);
  }
};

const recalculate = async (req, res, next) => {
  try {
    const result = await adminIntelligenceService.recalculate(req.body.trigger || "manual-recalculate");
    return successResponse(res, result, "Admin intelligence recalculated");
  } catch (error) {
    next(error);
  }
};

const exportReport = async (req, res, next) => {
  try {
    const { reportId, reportType, format } = req.body;
    const { body, contentType, filename } = await adminIntelligenceService.exportReport({ reportId, reportType, format });

    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.status(200).send(body);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getDashboard,
  getInstitutionHealth,
  getDepartments,
  getFaculty,
  getStudentRisk,
  getCompliance,
  getForecasts,
  getAlerts,
  getReports,
  recalculate,
  exportReport,
};
