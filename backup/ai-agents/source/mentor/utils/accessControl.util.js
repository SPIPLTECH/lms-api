const ApiError = require("../../../utils/ApiError");

/**
 * Unlike every prior agent, this module isn't role-gated — STUDENT,
 * INSTRUCTOR, and ADMIN can all use the mentor. Access control here is
 * strictly ownership-based: a user can only ever read/act on their own
 * conversations, with no admin-override read access, since this is a
 * personal AI-assistant surface, not an institutional report.
 *
 * @param {{userId: string}} actor
 * @param {{userId: string}} conversation
 */
const assertOwnsConversation = (actor, conversation) => {
  if (!conversation) throw new ApiError(404, "Conversation not found");
  if (conversation.userId !== actor.userId) throw new ApiError(403, "You do not have access to this conversation");
};

module.exports = { assertOwnsConversation };
