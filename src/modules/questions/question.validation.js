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

// Mirrors prisma/schema.prisma's `QuestionType` enum exactly (MCQ_SINGLE..
// SHORT_ANSWER are the current Question Repository form's types; the rest
// are legacy values still allowed on read/update paths).
const QUESTION_TYPES = [
  "MCQ_SINGLE",
  "MCQ_MULTI",
  "ARRANGE_TOKENS",
  "MATCH_PAIRS",
  "SELF_ASSESSMENT",
  "MCQ",
  "MULTIPLE_CORRECT",
  "TRUE_FALSE",
  "FILL_BLANK",
  "SHORT_ANSWER",
];

// `options`/`correctAnswer` are stored as Prisma `Json` — shape varies by
// questionType (MCQ_SINGLE/SELF_ASSESSMENT: string, MCQ_MULTI/ARRANGE_TOKENS:
// array, MATCH_PAIRS: object of left->right pairs), so validation only pins
// down the per-item option shape and otherwise accepts any of those shapes
// rather than a single one.
const optionsSchema = Joi.alternatives().try(Joi.array().items(optionSchema), Joi.object());
const correctAnswerSchema = Joi.alternatives().try(Joi.string().allow(""), Joi.array(), Joi.object());

const createQuestionSchema = Joi.object({
  title: Joi.string().optional().allow(null, ""),
  question: Joi.string().required(),
  options: optionsSchema.optional(),
  correctAnswer: correctAnswerSchema.required(),
  explanation: Joi.string().optional().allow(null, ""),
  // Renamed from the stale `type` (never read by questionRepositoryService,
  // which only reads `questionType` — every submission was silently saved
  // as the default MCQ_SINGLE regardless of what was actually picked).
  questionType: Joi.string().valid(...QUESTION_TYPES).optional(),
  // .uppercase() coerces "Medium" -> "MEDIUM" before the enum check, since
  // the Prisma DifficultyLevel enum is uppercase-only but the form's select
  // options are title-case for display.
  difficulty: Joi.string().uppercase().valid("EASY", "MEDIUM", "HARD").optional(),
  marks: Joi.number().integer().min(1).optional(),
  negativeMarks: Joi.number().min(0).optional(),
  tags: Joi.array().items(Joi.string()).optional(),
  quizId: Joi.string().optional().allow(null, ""),
  // Learner-model KC identifier (see quiz.service.js). Was previously
  // undeclared here, so joiValidation.middleware's stripUnknown:true was
  // silently discarding it before questionRepositoryService ever saw it.
  subject: Joi.string().trim().max(200).optional().allow(null, ""),
  topic: Joi.string().trim().max(200).optional().allow(null, "")
});

const updateQuestionSchema = Joi.object({
  title: Joi.string().optional().allow(null, ""),
  question: Joi.string().optional(),
  options: optionsSchema.optional(),
  correctAnswer: correctAnswerSchema.optional(),
  explanation: Joi.string().optional().allow(null, ""),
  questionType: Joi.string().valid(...QUESTION_TYPES).optional(),
  difficulty: Joi.string().uppercase().valid("EASY", "MEDIUM", "HARD").optional(),
  marks: Joi.number().integer().min(1).optional(),
  negativeMarks: Joi.number().min(0).optional(),
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
