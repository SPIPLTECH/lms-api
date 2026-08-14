const Joi = require("joi");

const initializeSchema = Joi.object({
  studentId: Joi.string().optional(),
  courseId: Joi.string().optional(),
  kcs: Joi.array()
    .items(
      Joi.object({
        kc: Joi.string().trim().min(1).required(),
        masteryProbability: Joi.number().min(0).max(1).optional().default(0),
        confidence: Joi.number().min(0).max(1).optional().default(0),
      })
    )
    .min(1)
    .required(),
});

const recordEvidenceSchema = Joi.object({
  studentId: Joi.string().optional(),
  kc: Joi.string().trim().min(1).required(),
  score: Joi.number().min(0).max(1).optional(),
  isCorrect: Joi.boolean().optional(),
  hintsUsed: Joi.number().integer().min(0).optional().default(0),
  responseTimeMs: Joi.number().integer().min(0).optional().default(0),
  misconceptionHypothesis: Joi.string().trim().max(500).optional(),
  misconceptionSeverity: Joi.number().min(0).max(1).optional().default(0.5),
  courseId: Joi.string().optional(),
  moduleId: Joi.string().optional(),
  lessonId: Joi.string().optional(),
  quizId: Joi.string().optional(),
  metadata: Joi.object().optional(),
});

const recordMisconceptionSchema = Joi.object({
  studentId: Joi.string().optional(),
  hypothesis: Joi.string().trim().min(1).max(500).required(),
  relatedKC: Joi.string().trim().optional(),
  probability: Joi.number().min(0).max(1).optional().default(0.5),
  status: Joi.string().valid("OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED").optional().default("OPEN"),
});

const getDecisionSchema = Joi.object({
  studentId: Joi.string().optional(),
  kc: Joi.string().trim().min(1).required(),
  courseId: Joi.string().optional(),
  hasNextTarget: Joi.boolean().optional().default(false),
});

module.exports = {
  initializeSchema,
  recordEvidenceSchema,
  recordMisconceptionSchema,
  getDecisionSchema,
};
