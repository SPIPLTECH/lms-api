const placementService = require("../services/placement.service");
const { successResponse } = require("../../../utils/response");
const { resolveTargetStudentId } = require("../utils/accessControl.util");

/** Controllers stay thin: resolve the target student where needed, delegate, shape the response. */

const getProfile = async (req, res, next) => {
  try {
    const studentId = resolveTargetStudentId(req.placementActor, req.params.studentId);
    const result = await placementService.getProfile(studentId);
    return successResponse(res, result, "Placement profile fetched");
  } catch (error) {
    next(error);
  }
};

/** Catalog browsing — open to any authenticated user, not student-scoped. */
const getJobs = async (req, res, next) => {
  try {
    const { page, limit, companyId, employmentType, isRemote, location } = req.query;
    const result = await placementService.getJobs({ skip: (page - 1) * limit, take: limit, companyId, employmentType, isRemote, location });
    return successResponse(res, result, "Job opportunities fetched");
  } catch (error) {
    next(error);
  }
};

const getInternships = async (req, res, next) => {
  try {
    const { page, limit, companyId, isRemote, isPPO, location } = req.query;
    const result = await placementService.getInternships({ skip: (page - 1) * limit, take: limit, companyId, isRemote, isPPO, location });
    return successResponse(res, result, "Internship opportunities fetched");
  } catch (error) {
    next(error);
  }
};

const getDrives = async (req, res, next) => {
  try {
    const result = await placementService.getDrives();
    return successResponse(res, result, "Placement drives fetched");
  } catch (error) {
    next(error);
  }
};

const getMatches = async (req, res, next) => {
  try {
    const studentId = resolveTargetStudentId(req.placementActor, req.query.studentId);
    const result = await placementService.getMatches(studentId, req.query.opportunityType);
    return successResponse(res, result, "Job matches fetched");
  } catch (error) {
    next(error);
  }
};

const getApplications = async (req, res, next) => {
  try {
    const studentId = resolveTargetStudentId(req.placementActor, req.query.studentId);
    const result = await placementService.getApplications(studentId, req.query.status);
    return successResponse(res, result, "Applications fetched");
  } catch (error) {
    next(error);
  }
};

const getInterviews = async (req, res, next) => {
  try {
    const studentId = resolveTargetStudentId(req.placementActor, req.query.studentId);
    const result = await placementService.getInterviews(studentId);
    return successResponse(res, result, "Interviews fetched");
  } catch (error) {
    next(error);
  }
};

const getOffers = async (req, res, next) => {
  try {
    const studentId = resolveTargetStudentId(req.placementActor, req.query.studentId);
    const result = await placementService.getOffers(studentId);
    return successResponse(res, result, "Offers fetched");
  } catch (error) {
    next(error);
  }
};

const recalculate = async (req, res, next) => {
  try {
    const studentId = resolveTargetStudentId(req.placementActor, req.body.studentId);
    const result = await placementService.recalculate(studentId);
    return successResponse(res, result, "Placement profile recalculated");
  } catch (error) {
    next(error);
  }
};

const createApplication = async (req, res, next) => {
  try {
    const studentId = resolveTargetStudentId(req.placementActor, req.body.studentId);
    const { opportunityType, opportunityId, driveId, notes } = req.body;
    const result = await placementService.createApplication(studentId, { opportunityType, opportunityId, driveId, notes });
    return successResponse(res, result, "Application tracked");
  } catch (error) {
    next(error);
  }
};

module.exports = { getProfile, getJobs, getInternships, getDrives, getMatches, getApplications, getInterviews, getOffers, recalculate, createApplication };
