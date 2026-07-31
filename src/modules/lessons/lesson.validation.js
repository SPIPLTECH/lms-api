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

const reorderLessonsSchema = Joi.object({
  moduleId: Joi.string().required(),
  lessons: Joi.array().items(
    Joi.object({
      id: Joi.string().required(),
      order: Joi.number().integer().min(0).required()
    })
  ).min(1).required()
});

module.exports = {
  createLessonSchema,
  updateLessonSchema,
  reorderLessonsSchema
};
