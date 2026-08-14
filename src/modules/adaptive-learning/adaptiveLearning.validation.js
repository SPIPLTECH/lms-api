const Joi = require("joi");

const respondSchema = Joi.object({
  kc: Joi.string().trim().min(1).required().messages({
    "any.required": "Knowledge component (kc) is required.",
    "string.empty": "Knowledge component (kc) cannot be empty.",
  }),
  message: Joi.string().trim().min(1).max(2000).required().messages({
    "any.required": "Student message is required.",
    "string.empty": "Student message cannot be empty.",
    "string.max": "Student message exceeds maximum length of 2000 characters.",
  }),
  courseId: Joi.string().optional(),
  hasNextTarget: Joi.boolean().optional(),
  // References only — never trusted content. adaptiveLearning.service.js
  // resolves the actual question text/options/correctAnswer/studentAnswer
  // server-side from these ids. Must be provided together or not at all.
  quizId: Joi.string().optional(),
  questionId: Joi.string().optional(),
}).and("quizId", "questionId");

const generateVerificationQuestionSchema = Joi.object({
  kc: Joi.string().trim().min(1).required().messages({
    "any.required": "Knowledge component (kc) is required.",
    "string.empty": "Knowledge component (kc) cannot be empty.",
  }),
  courseId: Joi.string().optional(),
  misconception: Joi.string().trim().max(500).optional(),
  purpose: Joi.string().trim().optional(),
  // Same reference-only contract as respondSchema — the server re-resolves
  // the actual question content, never trusts it from the client.
  quizId: Joi.string().optional(),
  questionId: Joi.string().optional(),
}).and("quizId", "questionId");

const evaluateVerificationAnswerSchema = Joi.object({
  verificationToken: Joi.string().trim().min(1).required().messages({
    "any.required": "verificationToken is required.",
  }),
  selectedAnswer: Joi.string().trim().min(1).required().messages({
    "any.required": "selectedAnswer is required.",
  }),
});

module.exports = {
  respondSchema,
  generateVerificationQuestionSchema,
  evaluateVerificationAnswerSchema,
};
