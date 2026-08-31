const Joi = require("joi");

const createGoalSchema = Joi.object({
  label: Joi.string().min(1).max(200).required(),
  target: Joi.number().integer().min(1).max(10000).required(),
  current: Joi.number().integer().min(0).max(10000).optional()
});

const updateGoalSchema = Joi.object({
  label: Joi.string().min(1).max(200).optional(),
  target: Joi.number().integer().min(1).max(10000).optional(),
  current: Joi.number().integer().min(0).max(10000).optional(),
  done: Joi.boolean().optional()
});

module.exports = {
  createGoalSchema,
  updateGoalSchema
};
