const Joi = require("joi");
const { LIMITS } = require("./constants/aiAssistant.constants");

// Cuid-ish. Loose on purpose: this is a cheap shape filter to reject obvious
// junk before it reaches the database, NOT an authorization check. Ownership
// and hierarchy are decided in access/, against real rows.
const id = Joi.string().trim().min(1).max(64);

const message = Joi.string()
  .trim()
  .min(1)
  .max(LIMITS.MAX_MESSAGE_CHARS)
  .required()
  .messages({
    "string.empty": "Message cannot be empty.",
    "any.required": "Message is required.",
    "string.max": `Message cannot exceed ${LIMITS.MAX_MESSAGE_CHARS} characters.`,
  });

/**
 * Learning position accepted from the client.
 *
 * quizId and assignmentId are deliberately ABSENT and are stripped by
 * stripUnknown below. The assistant never retrieves assessment material, so
 * accepting those ids would create the exact parameter an attacker needs to
 * reach for an answer key. If assessment-awareness is ever wanted in the UI,
 * it belongs as a boolean flag that changes prompt wording, never as an id
 * that drives retrieval.
 */
const positionFields = {
  courseId: id.optional().allow(null, ""),
  moduleId: id.optional().allow(null, ""),
  lessonId: id.optional().allow(null, ""),
  topicId: id.optional().allow(null, ""),
  contentIds: Joi.array().items(id).max(20).optional(),
};

const guestMessageSchema = Joi.object({
  message,
  courseId: id.optional().allow(null, ""),
}).options({ stripUnknown: true });

const conversationMessageSchema = Joi.object({
  message,
  ...positionFields,
}).options({ stripUnknown: true });

const createConversationSchema = Joi.object({
  title: Joi.string().trim().max(LIMITS.MAX_TITLE_CHARS).optional().allow("", null),
  courseId: id.optional().allow(null, ""),
}).options({ stripUnknown: true });

const updateConversationSchema = Joi.object({
  title: Joi.string().trim().max(LIMITS.MAX_TITLE_CHARS).optional().allow("", null),
  status: Joi.string().valid("ACTIVE", "ARCHIVED").optional(),
})
  .min(1)
  .options({ stripUnknown: true });

const conversationIdParamSchema = Joi.object({
  conversationId: id.required(),
});

const listConversationsQuerySchema = Joi.object({
  courseId: id.optional().allow(null, ""),
  status: Joi.string().valid("ACTIVE", "ARCHIVED").optional(),
}).options({ stripUnknown: true });

module.exports = {
  guestMessageSchema,
  conversationMessageSchema,
  createConversationSchema,
  updateConversationSchema,
  conversationIdParamSchema,
  listConversationsQuerySchema,
};
