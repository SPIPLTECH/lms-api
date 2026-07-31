const Joi = require("joi");

const createQuizSchema = Joi.object({
  title: Joi.string().required(),
  description: Joi.string().optional().allow(null, ""),
  courseId: Joi.string().required(),
  passingScore: Joi.number().integer().min(0).max(100).optional(),
  timeLimit: Joi.number().integer().min(0).optional().allow(null),
  isPublished: Joi.boolean().optional()
});

const updateQuizSchema = Joi.object({
  title: Joi.string().optional(),
  description: Joi.string().optional().allow(null, ""),
  passingScore: Joi.number().integer().min(0).max(100).optional(),
  timeLimit: Joi.number().integer().min(0).optional().allow(null),
  isPublished: Joi.boolean().optional()
});

const submitQuizSchema = Joi.object({
  answers: Joi.array().items(
    Joi.object({
      questionId: Joi.string().required(),
      answer: Joi.string().required().allow("")
    })
  ).required()
});

const importQuestionsToQuizSchema = Joi.object({
  questionIds: Joi.array().items(Joi.string()).min(1).required()
});

const reorderQuizQuestionsSchema = Joi.object({
  orderedQuestionIds: Joi.array().items(Joi.string()).min(1).required()
});

const updateQuizQuestionMarksSchema = Joi.object({
  marks: Joi.number().integer().min(0).required()
});

module.exports = {
  createQuizSchema,
  updateQuizSchema,
  submitQuizSchema,
  importQuestionsToQuizSchema,
  reorderQuizQuestionsSchema,
  updateQuizQuestionMarksSchema
};
