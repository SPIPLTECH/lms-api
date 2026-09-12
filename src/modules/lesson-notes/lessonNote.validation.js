const Joi = require("joi");

const attachmentSchema = Joi.object({
  url: Joi.string().uri().required(),
  name: Joi.string().required(),
  type: Joi.string().optional().allow(null, "")
});

const createLessonNoteSchema = Joi.object({
  lessonId: Joi.string().required(),
  content: Joi.string().min(1).max(20000).required(),
  timestampSeconds: Joi.number().integer().min(0).optional().allow(null),
  attachments: Joi.array().items(attachmentSchema).optional(),
  status: Joi.string().valid("DRAFT", "PUBLISHED").optional()
});

const updateLessonNoteSchema = Joi.object({
  content: Joi.string().min(1).max(20000).optional(),
  timestampSeconds: Joi.number().integer().min(0).optional().allow(null),
  attachments: Joi.array().items(attachmentSchema).optional(),
  status: Joi.string().valid("DRAFT", "PUBLISHED").optional()
});

module.exports = {
  createLessonNoteSchema,
  updateLessonNoteSchema
};
