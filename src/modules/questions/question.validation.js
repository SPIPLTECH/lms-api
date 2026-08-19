const Joi = require("joi");
const { MISCONCEPTION_TAXONOMY } = require("../learner-model/misconceptionTaxonomy.config");

const MISCONCEPTION_TYPES = Object.keys(MISCONCEPTION_TAXONOMY);

// An option may be a plain string (legacy — never carries a tag) or a richer
// object. `misconceptionTag`, when present, is validated against the
// controlled taxonomy right here — an unknown/invented type is rejected with
// a clear 400 at authoring time rather than silently accepted and only
// caught later at scoring time.
const optionSchema = Joi.alternatives().try(
  Joi.string().allow(""),
  Joi.object({
    optionText: Joi.string().required(),
    isCorrect: Joi.boolean().optional(),
    misconceptionTag: Joi.string().valid(...MISCONCEPTION_TYPES).optional(),
  })
);

// MCQ_SINGLE/MCQ_MULTI/ARRANGE_TOKENS/SELF_ASSESSMENT send a plain array of
// options (or none, for SELF_ASSESSMENT); MATCH_PAIRS sends a
// { left: [...], right: [...] } shape instead — QuestionForm.jsx builds
// that object directly, so it must be accepted here too, not just arrays.
const optionsValueSchema = Joi.alternatives().try(
  Joi.array().items(optionSchema),
  Joi.object({
    left: Joi.array().items(Joi.string().allow("")),
    right: Joi.array().items(Joi.string().allow("")),
  })
);

// Mirrors quiz.validation.js's answerValueSchema: MCQ_SINGLE/SELF_ASSESSMENT
// send a plain string, MCQ_MULTI/ARRANGE_TOKENS send an array of strings,
// and MATCH_PAIRS sends a string-keyed object (left -> right).
const answerValueSchema = Joi.alternatives().try(
  Joi.string().allow(""),
  Joi.array().items(Joi.string()),
  Joi.object().pattern(Joi.string(), Joi.string())
);

// The real QuestionType values the app writes (Prisma's QuestionType enum) —
// what QuestionForm.jsx actually sends (MCQ_SINGLE, MCQ_MULTI,
// ARRANGE_TOKENS, MATCH_PAIRS, SELF_ASSESSMENT) plus the legacy values other
// importers/callers use.
const QUESTION_TYPES = [
  "MCQ_SINGLE", "MCQ_MULTI", "ARRANGE_TOKENS", "MATCH_PAIRS", "SELF_ASSESSMENT",
  "MCQ", "MULTIPLE_CORRECT", "TRUE_FALSE", "FILL_BLANK", "SHORT_ANSWER", "LONG_ANSWER"
];

const createQuestionSchema = Joi.object({
  // Question has no `title` column — questionRepositoryService derives one
  // from the question text when none is supplied, so it's optional here.
  title: Joi.string().optional().allow(null, ""),
  question: Joi.string().required(),
  options: optionsValueSchema.optional(),
  correctAnswer: answerValueSchema.required(),
  explanation: Joi.string().optional().allow(null, ""),
  // Accepted under both names: QuestionForm.jsx sends `type`, other callers
  // (bulk import, course importer) send `questionType`.
  type: Joi.string().valid(...QUESTION_TYPES).optional(),
  questionType: Joi.string().valid(...QUESTION_TYPES).optional(),
  difficulty: Joi.string().valid("EASY", "MEDIUM", "HARD").insensitive().optional(),
  marks: Joi.number().integer().min(1).optional(),
  negativeMarks: Joi.number().min(0).optional(),
  tags: Joi.alternatives().try(Joi.array().items(Joi.string()), Joi.string().allow("")).optional(),
  // "Category / Concept tag" field in QuestionForm.jsx — stored in `tags`
  // (Question has no dedicated concept column).
  concept: Joi.string().trim().max(200).optional().allow(null, ""),
  quizId: Joi.string().optional().allow(null, ""),
  courseId: Joi.string().optional().allow(null, ""),
  moduleId: Joi.string().optional().allow(null, ""),
  // Learner-model KC identifier (see quiz.service.js). Was previously
  // undeclared here, so joiValidation.middleware's stripUnknown:true was
  // silently discarding it before questionRepositoryService ever saw it.
  subject: Joi.string().trim().max(200).optional().allow(null, ""),
  topic: Joi.string().trim().max(200).optional().allow(null, "")
});

const updateQuestionSchema = Joi.object({
  title: Joi.string().optional().allow(null, ""),
  question: Joi.string().optional(),
  options: optionsValueSchema.optional(),
  correctAnswer: answerValueSchema.optional(),
  explanation: Joi.string().optional().allow(null, ""),
  type: Joi.string().valid(...QUESTION_TYPES).optional(),
  questionType: Joi.string().valid(...QUESTION_TYPES).optional(),
  difficulty: Joi.string().valid("EASY", "MEDIUM", "HARD").insensitive().optional(),
  marks: Joi.number().integer().min(1).optional(),
  negativeMarks: Joi.number().min(0).optional(),
  tags: Joi.alternatives().try(Joi.array().items(Joi.string()), Joi.string().allow("")).optional(),
  concept: Joi.string().trim().max(200).optional().allow(null, ""),
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
