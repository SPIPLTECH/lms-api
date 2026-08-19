const Joi = require("joi");

const createQuizSchema = Joi.object({
  title: Joi.string().required(),
  description: Joi.string().optional().allow(null, ""),
  batchId: Joi.string().required(),
  courseId: Joi.string().required(),
  moduleId: Joi.string().optional().allow(null, ""),
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

// evaluateAnswer() (quiz.service.js) expects a plain string for MCQ_SINGLE /
// TRUE_FALSE / FILL_BLANK / SHORT_ANSWER / LONG_ANSWER, an array of strings
// for MCQ_MULTI / ARRANGE_TOKENS, and a string-keyed object for MATCH_PAIRS.
// A plain Joi.string() here rejected (or silently mis-scored, if the caller
// stringified it) the latter two shapes before they ever reached the scorer.
const answerValueSchema = Joi.alternatives().try(
  Joi.string().allow(""),
  Joi.array().items(Joi.string()),
  Joi.object().pattern(Joi.string(), Joi.string())
);

const submitQuizSchema = Joi.object({
  answers: Joi.array().items(
    Joi.object({
      questionId: Joi.string().required(),
      answer: answerValueSchema.required()
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

const generateSelfAssessmentQuizSchema = Joi.object({
  courseId: Joi.string().required(),
  questionCount: Joi.number().integer().min(1).max(50).optional()
});

module.exports = {
  createQuizSchema,
  updateQuizSchema,
  submitQuizSchema,
  importQuestionsToQuizSchema,
  reorderQuizQuestionsSchema,
  updateQuizQuestionMarksSchema,
  generateSelfAssessmentQuizSchema
};
