const Joi = require("joi");

// Consent problems are answered by the service with CONSENT_REQUIRED, so an empty
// body gets that message rather than a generic validation error.
const createAttemptSchema = Joi.object({
  consent: Joi.object({
    accepted: Joi.boolean(),
    wordingVersion: Joi.string().max(64),
  }).optional(),
});

const MAX_ANSWER_CHARS = 20000;

const saveAnswerSchema = Joi.object({
  answer: Joi.any()
    .custom((value, helpers) => (JSON.stringify(value ?? null).length > MAX_ANSWER_CHARS ? helpers.error("any.invalid") : value))
    .required(),
  clientRevision: Joi.number().integer().min(0).max(2147483647).required(),
  state: Joi.object({
    status: Joi.string().valid("NOT_VISITED", "VISITED", "ANSWERED", "SKIPPED"),
    visited: Joi.boolean(),
    skipped: Joi.boolean(),
    hintViewed: Joi.boolean(),
    firstVisitedAt: Joi.date().iso().allow(null),
    lastVisitedAt: Joi.date().iso().allow(null),
    answeredAt: Joi.date().iso().allow(null),
    skippedAt: Joi.date().iso().allow(null),
  }).optional(),
});

module.exports = { createAttemptSchema, saveAnswerSchema };
