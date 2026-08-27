const toMessageEntry = (message) => ({
  id: message.id,
  role: message.role,
  content: message.content,
  intent: message.intent,
  intentConfidence: message.intentConfidence,
  createdAt: message.createdAt,
});

const toConversationEntry = (conversation) => ({
  id: conversation.id,
  title: conversation.title,
  status: conversation.status,
  lastIntent: conversation.lastIntent,
  lastMessageAt: conversation.lastMessageAt,
  createdAt: conversation.createdAt,
});

/** POST /mentor/chat */
const toChatResponse = ({ conversationId, userMessage, assistantMessage, intentResult, agentsQueried }) => ({
  conversationId,
  message: toMessageEntry(assistantMessage),
  userMessage: toMessageEntry(userMessage),
  intent: intentResult.intent,
  intentConfidence: intentResult.confidence,
  agentsQueried,
});

/** GET /mentor/history */
const toHistoryResponse = (conversations, total, page, limit) => ({
  count: conversations.length,
  total,
  page,
  limit,
  conversations: conversations.map(toConversationEntry),
});

/** GET /mentor/context */
const toContextResponse = (mergedContext) => ({
  role: mergedContext.actor.role,
  dataFromAgents: mergedContext.byAgent,
  rankedSuggestions: mergedContext.rankedSuggestions,
  notificationCount: mergedContext.notifications.length,
  recentActivityCount: mergedContext.recentActivity.length,
  upcomingCalendarEvents: mergedContext.calendarEvents,
  gatheredAt: mergedContext.gatheredAt,
});

/** GET /mentor/recommendations */
const toRecommendationsResponse = (mergedContext) => ({
  count: mergedContext.rankedSuggestions.length,
  recommendations: mergedContext.rankedSuggestions,
});

/** GET /mentor/conversation/:id */
const toConversationDetailResponse = (conversation, messages) => ({
  ...toConversationEntry(conversation),
  messages: messages.map(toMessageEntry),
});

/** POST /mentor/feedback */
const toFeedbackResponse = (feedback) => ({
  id: feedback.id,
  messageId: feedback.messageId,
  rating: feedback.rating,
  comment: feedback.comment,
  createdAt: feedback.createdAt,
});

module.exports = {
  toMessageEntry,
  toConversationEntry,
  toChatResponse,
  toHistoryResponse,
  toContextResponse,
  toRecommendationsResponse,
  toConversationDetailResponse,
  toFeedbackResponse,
};
