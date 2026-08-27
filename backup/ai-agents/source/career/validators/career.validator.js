const Joi = require("joi");
const { ROADMAP_HORIZON, CAREER_RECOMMENDATION_TYPE } = require("../constants");

/** studentId is optional here — required-for-staff/locked-for-student is enforced by utils/accessControl.util.js#resolveTargetStudentId, not by shape validation. */
const studentIdQuerySchema = Joi.object({
  studentId: Joi.string().min(1).max(64).optional(),
});

const roadmapQuerySchema = Joi.object({
  studentId: Joi.string().min(1).max(64).optional(),
  horizon: Joi.string()
    .valid(...Object.values(ROADMAP_HORIZON))
    .optional(),
});

const recommendationsQuerySchema = Joi.object({
  studentId: Joi.string().min(1).max(64).optional(),
  type: Joi.string()
    .valid(...Object.values(CAREER_RECOMMENDATION_TYPE))
    .optional(),
});

const recalculateBodySchema = Joi.object({
  studentId: Joi.string().min(1).max(64).optional(),
});

const goalBodySchema = Joi.object({
  studentId: Joi.string().min(1).max(64).optional(),
  targetRoleId: Joi.string().min(1).max(64),
  targetRoleName: Joi.string().min(1).max(120),
  targetDate: Joi.date().iso().optional(),
  notes: Joi.string().max(1000).optional().allow(""),
})
  .xor("targetRoleId", "targetRoleName")
  .messages({ "object.xor": "Provide exactly one of targetRoleId or targetRoleName" });

module.exports = { studentIdQuerySchema, roadmapQuerySchema, recommendationsQuerySchema, recalculateBodySchema, goalBodySchema };
