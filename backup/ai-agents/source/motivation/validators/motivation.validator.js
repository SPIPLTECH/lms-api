const Joi = require("joi");
const { MOTIVATION_ACTION_TYPE, MOTIVATION_PRIORITY } = require("../constants");

const studentIdField = Joi.string().min(1).max(64);

const studentIdQuerySchema = Joi.object({
  studentId: studentIdField.optional(),
});

const actionsQuerySchema = Joi.object({
  studentId: studentIdField.optional(),
  type: Joi.string()
    .valid(...Object.values(MOTIVATION_ACTION_TYPE))
    .optional(),
  priority: Joi.string()
    .valid(...Object.values(MOTIVATION_PRIORITY))
    .optional(),
});

const historyQuerySchema = Joi.object({
  studentId: studentIdField.optional(),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
});

const recalculateBodySchema = Joi.object({
  studentId: studentIdField.optional(),
});

const acknowledgeBodySchema = Joi.object({
  studentId: studentIdField.optional(),
  motivationActionId: Joi.string().min(1).max(64).required(),
});

module.exports = {
  studentIdQuerySchema,
  actionsQuerySchema,
  historyQuerySchema,
  recalculateBodySchema,
  acknowledgeBodySchema,
};
