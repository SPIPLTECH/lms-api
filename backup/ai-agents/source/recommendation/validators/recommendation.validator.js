const Joi = require("joi");
const { FEEDBACK_ACTION } = require("../constants");

const studentIdField = Joi.string().min(1).max(64);

const studentIdQuerySchema = Joi.object({
  studentId: studentIdField.optional(),
});

const recalculateBodySchema = Joi.object({
  studentId: studentIdField.optional(),
});

const feedbackBodySchema = Joi.object({
  studentId: studentIdField.optional(),
  recommendationId: Joi.string().min(1).max(64).required(),
  action: Joi.string()
    .valid(...Object.values(FEEDBACK_ACTION))
    .required(),
  comment: Joi.string().max(1000).allow("", null).optional(),
});

module.exports = {
  studentIdQuerySchema,
  recalculateBodySchema,
  feedbackBodySchema,
};
