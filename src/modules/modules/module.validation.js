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

const reorderModulesSchema = Joi.object({
  courseId: Joi.string().required(),
  modules: Joi.array().items(
    Joi.object({
      id: Joi.string().required(),
      order: Joi.number().integer().min(0).required()
    })
  ).min(1).required()
});

module.exports = {
  createModuleSchema,
  updateModuleSchema,
  reorderModulesSchema
};
