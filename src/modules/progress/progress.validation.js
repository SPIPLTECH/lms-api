const Joi = require("joi");

const completeLessonSchema = Joi.object({
  lessonId: Joi.string().required().messages({
    "any.required": "lessonId is required"
  }),
});

module.exports = {
  completeLessonSchema
};
