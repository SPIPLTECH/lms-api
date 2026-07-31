const prisma = require("../config/database");
const ApiError = require("../utils/ApiError");

/**
 * Verifies the caller is a participant of req.params.conversationId (or
 * ADMIN). Used to gate rename/delete so a conversation can only be modified
 * by someone actually in it — previously these routes had no check at all
 * beyond "is logged in", so any authenticated user could rename or delete
 * any conversation by id.
 */
const verifyConversationParticipant = async (req, res, next) => {
  try {
    if (!req.user) {
      return next(new ApiError(401, "Authentication required"));
    }

    const { conversationId } = req.params;

    if (!conversationId) {
      return next(new ApiError(400, "conversationId is required"));
    }

    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { id: true },
    });

    if (!conversation) {
      return next(new ApiError(404, "Conversation not found"));
    }

    if (req.user.role === "ADMIN") {
      return next();
    }

    const participant = await prisma.conversationParticipant.findFirst({
      where: { conversationId, userId: req.user.id },
      select: { id: true },
    });

    if (!participant) {
      return next(
        new ApiError(403, "Forbidden: you are not a participant in this conversation")
      );
    }

    next();
  } catch (error) {
    next(error);
  }
};

module.exports = verifyConversationParticipant;
module.exports.verifyConversationParticipant = verifyConversationParticipant;
