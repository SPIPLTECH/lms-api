const entryAssessmentService = require("../services/entryAssessment.service");
const { successResponse } = require("../../../utils/response");
const { resolveTargetStudentId } = require("../utils/accessControl.util");

const generate = async (req, res, next) => {
  try {
    // The real frontend calls POST .../generate with no request body at all
    // (nothing to send — courseId is already in the URL), so express.json()
    // never runs and req.body stays undefined. Optional chaining, not a
    // validate() middleware, since there's genuinely nothing to validate.
    const targetStudentId = resolveTargetStudentId(req.actor, req.body?.studentId);
    const result = await entryAssessmentService.generateForStudent(targetStudentId, req.params.courseId);
    return successResponse(res, result, "Entry assessment generated");
  } catch (error) {
    next(error);
  }
};

const getCurrent = async (req, res, next) => {
  try {
    const targetStudentId = resolveTargetStudentId(req.actor, req.query.studentId);
    const result = await entryAssessmentService.getEntryAssessment(targetStudentId, req.params.courseId);
    return successResponse(res, result, "Entry assessment fetched");
  } catch (error) {
    next(error);
  }
};

const submit = async (req, res, next) => {
  try {
    const targetStudentId = resolveTargetStudentId(req.actor, req.body?.studentId);
    const result = await entryAssessmentService.submitEntryAssessment(targetStudentId, req.params.courseId, req.body?.answers);
    return successResponse(res, result, "Entry assessment submitted and evaluated");
  } catch (error) {
    next(error);
  }
};

const getResult = async (req, res, next) => {
  try {
    const targetStudentId = resolveTargetStudentId(req.actor, req.query.studentId);
    const result = await entryAssessmentService.getResult(targetStudentId, req.params.courseId);
    return successResponse(res, result, "Entry assessment result fetched");
  } catch (error) {
    next(error);
  }
};

module.exports = { generate, getCurrent, submit, getResult };
