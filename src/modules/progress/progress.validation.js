const Joi = require("joi");

const completeContentSchema = Joi.object({
  // A merged "document" block in the player stands for several real Content
  // rows, all completed together — contentIds carries that batch; contentId
  // stays required for single-item callers so the common case still 400s
  // with a clear message when it's missing.
  contentId: Joi.string().optional().messages({
    "string.empty": "contentId cannot be empty"
  }),
  contentIds: Joi.array().items(Joi.string()).min(1).optional(),
  completed: Joi.boolean().optional().default(true)
}).or("contentId", "contentIds").messages({
  "object.missing": "contentId is required"
});

const completeLessonSchema = Joi.object({
  lessonId: Joi.string().required().messages({
    "any.required": "lessonId is required",
    "string.empty": "lessonId cannot be empty"
  }),
  completed: Joi.boolean().optional().default(true)
});

const markVisitedSchema = Joi.object({
  // SUBTOPIC/CONCEPT added: without them the two new container levels would be
  // rejected at the validation layer with a 400 before ever reaching the
  // service. Every previously-valid payload stays valid.
  entityType: Joi.string()
    .valid("CONTENT", "QUIZ", "ASSIGNMENT", "CONCEPT", "SUBTOPIC", "TOPIC", "LESSON", "MODULE")
    .optional(),
  entityId: Joi.string().optional(),
  contentId: Joi.string().optional(),
  quizId: Joi.string().optional(),
  assignmentId: Joi.string().optional(),
  conceptId: Joi.string().optional(),
  subTopicId: Joi.string().optional(),
  topicId: Joi.string().optional(),
  lessonId: Joi.string().optional(),
  moduleId: Joi.string().optional(),
  visited: Joi.boolean().optional().default(true)
}).or(
  "entityId",
  "contentId",
  "quizId",
  "assignmentId",
  "conceptId",
  "subTopicId",
  "topicId",
  "lessonId",
  "moduleId"
);

module.exports = {
  completeContentSchema,
  completeLessonSchema,
  markVisitedSchema
};
