const Joi = require("joi");

const studentIdField = Joi.string().min(1).max(64);

const studentIdQuerySchema = Joi.object({
  studentId: studentIdField.optional(),
});

const recalculateBodySchema = Joi.object({
  studentId: studentIdField.optional(),
});

module.exports = {
  studentIdQuerySchema,
  recalculateBodySchema,
};
