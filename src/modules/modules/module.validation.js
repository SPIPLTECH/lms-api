const Joi = require("joi");

const createModuleSchema = Joi.object({
  title: Joi.string().required(),
  description: Joi.string().optional().allow(null, ""),
  courseId: Joi.string().required(),
  isPublished: Joi.boolean().optional()
});

const updateModuleSchema = Joi.object({
  title: Joi.string().optional(),
  description: Joi.string().optional().allow(null, ""),
  isPublished: Joi.boolean().optional()
});

module.exports = {
  createModuleSchema,
  updateModuleSchema,
};
