const Joi = require("joi");

const studentIdField = Joi.string().min(1).max(64);

const studentIdQuerySchema = Joi.object({
  studentId: studentIdField.optional(),
});

const historyQuerySchema = Joi.object({
  studentId: studentIdField.optional(),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
});

const evaluateBodySchema = Joi.object({
  studentId: studentIdField.optional(),
  eventId: Joi.string().min(1).max(64).required(),
});

const recalculateBodySchema = Joi.object({
  studentId: studentIdField.optional(),
});

module.exports = {
  studentIdQuerySchema,
  historyQuerySchema,
  evaluateBodySchema,
  recalculateBodySchema,
};
