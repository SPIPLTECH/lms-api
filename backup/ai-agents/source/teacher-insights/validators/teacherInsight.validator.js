const Joi = require("joi");

const courseIdQuerySchema = Joi.object({
  courseId: Joi.string().min(1).max(64).required(),
});

const recalculateBodySchema = Joi.object({
  courseId: Joi.string().min(1).max(64).required(),
});

module.exports = { courseIdQuerySchema, recalculateBodySchema };
