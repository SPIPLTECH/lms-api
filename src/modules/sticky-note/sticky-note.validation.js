const Joi = require("joi");

const stickyNoteCreateSchema = Joi.object({
  lessonId: Joi.string().required().messages({
    "any.required": "Lesson ID is required",
    "string.empty": "Lesson ID cannot be empty"
  }),
  content: Joi.string().trim().max(5000).required().messages({
    "any.required": "Content is required",
    "string.empty": "Content cannot be empty",
    "string.max": "Content must be 5000 characters or less"
  }),
  color: Joi.string().optional().allow(null, "").messages({
    "string.base": "Color must be a string"
  }),
  timestamp: Joi.number().integer().min(0).optional().allow(null).messages({
    "number.base": "Timestamp must be a positive integer",
    "number.min": "Timestamp must be a positive integer"
  })
});

const stickyNoteUpdateSchema = Joi.object({
  content: Joi.string().trim().max(5000).optional().messages({
    "string.empty": "Content cannot be empty",
    "string.max": "Content must be 5000 characters or less"
  }),
  color: Joi.string().optional().allow(null, "").messages({
    "string.base": "Color must be a string"
  }),
  timestamp: Joi.number().integer().min(0).optional().allow(null).messages({
    "number.base": "Timestamp must be a positive integer",
    "number.min": "Timestamp must be a positive integer"
  }),
  isPinned: Joi.boolean().optional().messages({
    "boolean.base": "isPinned must be true or false"
  })
});

module.exports = {
  stickyNoteCreateSchema,
  stickyNoteUpdateSchema
};