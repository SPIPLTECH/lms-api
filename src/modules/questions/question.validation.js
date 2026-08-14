const Joi = require("joi");
const { MISCONCEPTION_TAXONOMY } = require("../learner-model/misconceptionTaxonomy.config");

const MISCONCEPTION_TYPES = Object.keys(MISCONCEPTION_TAXONOMY);

// An option may be a plain string (legacy — never carries a tag) or a richer
// object. `misconceptionTag`, when present, is validated against the
// controlled taxonomy right here — an unknown/invented type is rejected with
// a clear 400 at authoring time rather than silently accepted and only
// caught later at scoring time.
const optionSchema = Joi.alternatives().try(
  Joi.string(),
  Joi.object({
    optionText: Joi.string().required(),
    isCorrect: Joi.boolean().optional(),
    misconceptionTag: Joi.string().valid(...MISCONCEPTION_TYPES).optional(),
  })
);

const createQuestionSchema = Joi.object({
  title: Joi.string().required(),
  question: Joi.string().required(),
  options: Joi.array().items(optionSchema).optional(),
  correctAnswer: Joi.string().required(),
  explanation: Joi.string().optional().allow(null, ""),
  type: Joi.string().valid("MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER").optional(),
  difficulty: Joi.string().valid("EASY", "MEDIUM", "HARD").optional(),
  marks: Joi.number().integer().min(1).optional(),
  tags: Joi.array().items(Joi.string()).optional(),
  quizId: Joi.string().optional().allow(null, ""),
  // Learner-model KC identifier (see quiz.service.js). Was previously
  // undeclared here, so joiValidation.middleware's stripUnknown:true was
  // silently discarding it before questionRepositoryService ever saw it.
  subject: Joi.string().trim().max(200).optional().allow(null, ""),
  topic: Joi.string().trim().max(200).optional().allow(null, "")
});

const updateQuestionSchema = Joi.object({
  title: Joi.string().optional(),
  question: Joi.string().optional(),
  options: Joi.array().items(optionSchema).optional(),
  correctAnswer: Joi.string().optional(),
  explanation: Joi.string().optional().allow(null, ""),
  type: Joi.string().valid("MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER").optional(),
  difficulty: Joi.string().valid("EASY", "MEDIUM", "HARD").optional(),
  marks: Joi.number().integer().min(1).optional(),
  tags: Joi.array().items(Joi.string()).optional(),
  subject: Joi.string().trim().max(200).optional().allow(null, ""),
  topic: Joi.string().trim().max(200).optional().allow(null, "")
});

const bulkCreateQuestionsSchema = Joi.object({
  quizId: Joi.string().optional().allow(null, ""),
  // Each question keeps its existing free-form shape (`.unknown(true)`) —
  // only `options` is pinned to a validated shape, so a misconceptionTag
  // gets the same taxonomy check here as the single-question path.
  questions: Joi.array()
    .items(Joi.object({ options: Joi.array().items(optionSchema).optional() }).unknown(true))
    .min(1)
    .required()
});

module.exports = {
  createQuestionSchema,
  updateQuestionSchema,
  bulkCreateQuestionsSchema
};
