const Joi = require("joi");

const createLessonSchema = Joi.object({
  title: Joi.string().required(),
  description: Joi.string().optional().allow(null, ""),
  moduleId: Joi.string().required(),
  isPublished: Joi.boolean().optional()
});

const updateLessonSchema = Joi.object({
  title: Joi.string().optional(),
  description: Joi.string().optional().allow(null, ""),
  isPublished: Joi.boolean().optional()
});

module.exports = {
  createLessonSchema,
  updateLessonSchema,
};
