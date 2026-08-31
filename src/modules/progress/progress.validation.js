const Joi = require("joi");

const completeLessonSchema = Joi.object({
  lessonId: Joi.string().required().messages({
    "any.required": "lessonId is required"
  }),
});

const markContentVisitedSchema = Joi.object({
  contentIds: Joi.array().items(Joi.string()).min(1).required().messages({
    "any.required": "contentIds is required",
    "array.min": "contentIds must contain at least one id"
  }),
});

module.exports = {
  completeLessonSchema,
  markContentVisitedSchema
};
