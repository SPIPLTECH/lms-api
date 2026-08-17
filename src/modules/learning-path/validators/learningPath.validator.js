const Joi = require("joi");
const { RECOMMENDATION_TYPE } = require("../constants");

/** studentId is optional here — required-for-staff/locked-for-student is enforced by utils/accessControl.util.js#resolveTargetStudentId, not by shape validation. */
const studentIdQuerySchema = Joi.object({
  studentId: Joi.string().min(1).max(64).optional(),
});

const recommendationsQuerySchema = Joi.object({
  studentId: Joi.string().min(1).max(64).optional(),
  type: Joi.string()
    .valid(...Object.values(RECOMMENDATION_TYPE))
    .optional(),
});

const milestonesQuerySchema = Joi.object({
  studentId: Joi.string().min(1).max(64).optional(),
  courseId: Joi.string().min(1).max(64).optional(),
});

const recalculateBodySchema = Joi.object({
  studentId: Joi.string().min(1).max(64).optional(),
});

module.exports = { studentIdQuerySchema, recommendationsQuerySchema, milestonesQuerySchema, recalculateBodySchema };
