const Joi = require("joi");
const { FEEDBACK_RATING } = require("../constants");

const chatBodySchema = Joi.object({
  conversationId: Joi.string().min(1).max(64).optional(),
  message: Joi.string().trim().min(1).max(4000).required(),
});

const historyQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
});

const feedbackBodySchema = Joi.object({
  messageId: Joi.string().min(1).max(64).required(),
  rating: Joi.string()
    .valid(...Object.values(FEEDBACK_RATING))
    .required(),
  comment: Joi.string().trim().max(1000).optional().allow(""),
});

module.exports = { chatBodySchema, historyQuerySchema, feedbackBodySchema };
