const Joi = require("joi");

const createQuestionSchema = Joi.object({
  title: Joi.string().required(),
  question: Joi.string().required(),
  options: Joi.array().items(Joi.string()).optional(),
  correctAnswer: Joi.string().required(),
  explanation: Joi.string().optional().allow(null, ""),
  type: Joi.string().valid("MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER").optional(),
  difficulty: Joi.string().valid("EASY", "MEDIUM", "HARD").optional(),
  marks: Joi.number().integer().min(1).optional(),
  tags: Joi.array().items(Joi.string()).optional(),
  quizId: Joi.string().optional().allow(null, "")
});

const updateQuestionSchema = Joi.object({
  title: Joi.string().optional(),
  question: Joi.string().optional(),
  options: Joi.array().items(Joi.string()).optional(),
  correctAnswer: Joi.string().optional(),
  explanation: Joi.string().optional().allow(null, ""),
  type: Joi.string().valid("MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER").optional(),
  difficulty: Joi.string().valid("EASY", "MEDIUM", "HARD").optional(),
  marks: Joi.number().integer().min(1).optional(),
  tags: Joi.array().items(Joi.string()).optional(),
});

const bulkCreateQuestionsSchema = Joi.object({
  quizId: Joi.string().optional().allow(null, ""),
  questions: Joi.array().items(Joi.object().unknown(true)).min(1).required()
});

module.exports = {
  createQuestionSchema,
  updateQuestionSchema,
  bulkCreateQuestionsSchema
};
