const Joi = require("joi");

// A question is asked from one item — a content block, a quiz or an
// assignment (the lesson/module/course is worked out from it) — or
// scope-wide (courseId, moduleId, lessonId).
const createLessonQuerySchema = Joi.object({
  courseId: Joi.string().optional(),
  moduleId: Joi.string().optional(),
  lessonId: Joi.string().optional(),
  contentId: Joi.string().optional(),
  quizId: Joi.string().optional(),
  assignmentId: Joi.string().optional(),
  question: Joi.string().trim().min(1).max(2000).required()
})
  .or("courseId", "moduleId", "lessonId", "contentId", "quizId", "assignmentId")
  .oxor("contentId", "quizId", "assignmentId")
  .messages({
    "object.missing": "A question must be asked from a course, module, lesson or an item in it.",
    "object.oxor": "A question can be about only one item."
  });

const replyLessonQuerySchema = Joi.object({
  reply: Joi.string().min(1).max(2000).required()
});

module.exports = {
  createLessonQuerySchema,
  replyLessonQuerySchema,
};
