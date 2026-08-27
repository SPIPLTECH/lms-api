const Joi = require("joi");

const createConversationSchema = Joi.object({
  title: Joi.string().trim().max(100).optional().allow("", null),
});

const sendMessageSchema = Joi.object({
  content: Joi.string().trim().min(1).max(4000).required().messages({
    "string.empty": "Message content cannot be empty",
    "any.required": "Message content is required",
    "string.max": "Message content cannot exceed 4000 characters",
  }),
  quizId: Joi.string().trim().optional().allow("", null),
  courseId: Joi.string().trim().optional().allow("", null),
});

const conversationIdParamSchema = Joi.object({
  conversationId: Joi.string().trim().required().messages({
    "any.required": "Conversation ID is required",
  }),
});

module.exports = {
  createConversationSchema,
  sendMessageSchema,
  conversationIdParamSchema,
};
