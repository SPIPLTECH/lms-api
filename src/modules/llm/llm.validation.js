const Joi = require("joi");

const generateSchema = Joi.object({
  systemPrompt: Joi.string().max(4000).allow("").optional().messages({
    "string.max": "systemPrompt must be 4000 characters or less",
  }),
  prompt: Joi.string().trim().min(1).max(4000).required().messages({
    "any.required": "prompt is required",
    "string.empty": "prompt cannot be empty",
    "string.max": "prompt must be 4000 characters or less",
  }),
  context: Joi.object().max(20).optional().messages({
    "object.max": "context may not have more than 20 keys",
  }),
  think: Joi.boolean().optional().default(false).messages({
    "boolean.base": "think must be true or false",
  }),
});

module.exports = { generateSchema };
