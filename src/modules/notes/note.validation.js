const Joi = require("joi");

const noteCreateSchema = Joi.object({
  title: Joi.string().trim().max(255).required().messages({
    "any.required": "Title is required",
    "string.empty": "Title cannot be empty",
    "string.max": "Title must be 255 characters or less"
  }),
  content: Joi.string().max(20000).optional().allow(null, "").messages({
    "string.max": "Content must be 20000 characters or less"
  }),
  category: Joi.string().max(100).optional().allow(null, "").messages({
    "string.max": "Category must be 100 characters or less"
  })
});

const noteUpdateSchema = Joi.object({
  title: Joi.string().trim().max(255).optional().messages({
    "string.empty": "Title cannot be empty",
    "string.max": "Title must be 255 characters or less"
  }),
  content: Joi.string().max(20000).optional().allow(null, "").messages({
    "string.max": "Content must be 20000 characters or less"
  }),
  category: Joi.string().max(100).optional().allow(null, "").messages({
    "string.max": "Category must be 100 characters or less"
  })
});

module.exports = { noteCreateSchema, noteUpdateSchema };
