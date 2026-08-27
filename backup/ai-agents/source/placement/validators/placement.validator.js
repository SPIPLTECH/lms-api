const Joi = require("joi");
const { OPPORTUNITY_TYPE, EMPLOYMENT_TYPE, APPLICATION_STATUS } = require("../constants");

/** studentId is optional here — required-for-staff/locked-for-student is enforced by utils/accessControl.util.js#resolveTargetStudentId, not by shape validation. */
const studentIdQuerySchema = Joi.object({
  studentId: Joi.string().min(1).max(64).optional(),
});

const jobsQuerySchema = Joi.object({
  companyId: Joi.string().min(1).max(64).optional(),
  employmentType: Joi.string()
    .valid(...Object.values(EMPLOYMENT_TYPE))
    .optional(),
  isRemote: Joi.boolean().optional(),
  location: Joi.string().max(120).optional(),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(50).default(20),
});

const internshipsQuerySchema = Joi.object({
  companyId: Joi.string().min(1).max(64).optional(),
  isRemote: Joi.boolean().optional(),
  isPPO: Joi.boolean().optional(),
  location: Joi.string().max(120).optional(),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(50).default(20),
});

const matchesQuerySchema = Joi.object({
  studentId: Joi.string().min(1).max(64).optional(),
  opportunityType: Joi.string()
    .valid(...Object.values(OPPORTUNITY_TYPE))
    .optional(),
});

const applicationsQuerySchema = Joi.object({
  studentId: Joi.string().min(1).max(64).optional(),
  status: Joi.string()
    .valid(...Object.values(APPLICATION_STATUS))
    .optional(),
});

const recalculateBodySchema = Joi.object({
  studentId: Joi.string().min(1).max(64).optional(),
});

const applicationBodySchema = Joi.object({
  studentId: Joi.string().min(1).max(64).optional(),
  opportunityType: Joi.string()
    .valid(...Object.values(OPPORTUNITY_TYPE))
    .required(),
  opportunityId: Joi.string().min(1).max(64).required(),
  driveId: Joi.string().min(1).max(64).optional(),
  notes: Joi.string().max(1000).optional().allow(""),
});

module.exports = {
  studentIdQuerySchema,
  jobsQuerySchema,
  internshipsQuerySchema,
  matchesQuerySchema,
  applicationsQuerySchema,
  recalculateBodySchema,
  applicationBodySchema,
};
