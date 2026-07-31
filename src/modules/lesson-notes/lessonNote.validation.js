const Joi = require("joi");

const createLessonNoteSchema = Joi.object({
  lessonId: Joi.string().required(),
  content: Joi.string().min(1).max(5000).required(),
  timestampSeconds: Joi.number().integer().min(0).optional().allow(null)
});

const updateLessonNoteSchema = Joi.object({
  content: Joi.string().min(1).max(5000).optional(),
  timestampSeconds: Joi.number().integer().min(0).optional().allow(null)
});

module.exports = {
  createLessonNoteSchema,
  updateLessonNoteSchema
};
