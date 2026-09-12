const Joi = require("joi");

// A question is asked from one item — a content block, a quiz or an
// assignment (the lesson is worked out from it) — or lesson-wide (lessonId).
const createLessonQuerySchema = Joi.object({
  lessonId: Joi.string().optional(),
  contentId: Joi.string().optional(),
  quizId: Joi.string().optional(),
  assignmentId: Joi.string().optional(),
  question: Joi.string().trim().min(1).max(2000).required()
})
  .or("lessonId", "contentId", "quizId", "assignmentId")
  .oxor("contentId", "quizId", "assignmentId")
  .messages({
    "object.missing": "A question must be asked from a lesson or an item in it.",
    "object.oxor": "A question can be about only one item."
  });

const replyLessonQuerySchema = Joi.object({
  reply: Joi.string().min(1).max(2000).required()
});

const updateStatusSchema = Joi.object({
  status: Joi.string().valid("PENDING", "ANSWERED").required()
});

module.exports = {
  createLessonQuerySchema,
  replyLessonQuerySchema,
  updateStatusSchema
};
