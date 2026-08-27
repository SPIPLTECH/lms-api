const Joi = require("joi");

const studentIdQuerySchema = Joi.object({
  studentId: Joi.string().min(1).max(64).optional(),
});

const submitBodySchema = Joi.object({
  studentId: Joi.string().min(1).max(64).optional(),
  answers: Joi.object().pattern(Joi.string(), Joi.number().integer().min(0)).required(),
});

module.exports = { studentIdQuerySchema, submitBodySchema };
