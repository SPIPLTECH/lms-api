const Joi = require("joi");

const completeContentSchema = Joi.object({
  contentId: Joi.string().required().messages({
    "any.required": "contentId is required",
    "string.empty": "contentId cannot be empty"
  }),
  completed: Joi.boolean().optional().default(true)
});

const completeLessonSchema = Joi.object({
  lessonId: Joi.string().required().messages({
    "any.required": "lessonId is required",
    "string.empty": "lessonId cannot be empty"
  }),
  completed: Joi.boolean().optional().default(true)
});

module.exports = {
  completeContentSchema,
  completeLessonSchema
};
