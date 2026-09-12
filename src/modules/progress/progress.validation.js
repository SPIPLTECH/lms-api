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

const markVisitedSchema = Joi.object({
  entityType: Joi.string().valid("CONTENT", "QUIZ", "ASSIGNMENT", "TOPIC", "LESSON", "MODULE").optional(),
  entityId: Joi.string().optional(),
  contentId: Joi.string().optional(),
  quizId: Joi.string().optional(),
  assignmentId: Joi.string().optional(),
  topicId: Joi.string().optional(),
  lessonId: Joi.string().optional(),
  moduleId: Joi.string().optional(),
  visited: Joi.boolean().optional().default(true)
}).or("entityId", "contentId", "quizId", "assignmentId", "topicId", "lessonId", "moduleId");

module.exports = {
  completeContentSchema,
  completeLessonSchema,
  markVisitedSchema
};
