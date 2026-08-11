const ApiError = require("../../../utils/ApiError");
const observation = require("../../observation");

const orchestrator = require("../orchestrator");
const memory = require("../memory");

const mentorConversationRepository = require("../repositories/mentorConversation.repository");
const mentorMessageRepository = require("../repositories/mentorMessage.repository");
const conversationContextRepository = require("../repositories/conversationContext.repository");
const agentInvocationRepository = require("../repositories/agentInvocation.repository");
const mentorMemoryRepository = require("../repositories/mentorMemory.repository");
const conversationSummaryRepository = require("../repositories/conversationSummary.repository");
const responseFeedbackRepository = require("../repositories/responseFeedback.repository");

const { assertOwnsConversation } = require("../utils/accessControl.util");
const { MESSAGE_ROLE, USER_ROLE, HISTORY_PAGE_SIZE } = require("../constants");

const {
  toChatResponse,
  toHistoryResponse,
  toContextResponse,
  toRecommendationsResponse,
  toConversationDetailResponse,
  toFeedbackResponse,
} = require("../dto/mentorResponse.dto");

/**
 * Fire-and-forget: publishes the real Observation event these agents
 * already read but nothing has ever produced (see this module's index.js
 * doc). Never allowed to affect the chat response — a failure here is
 * logged, not thrown.
 */
const publishAiHintEvent = (actor, intent, conversationId) => {
  if (actor.role !== USER_ROLE.STUDENT) return;
  observation
    .publishEvent({
      studentId: actor.studentId,
      eventType: observation.EVENT_TYPES.AI_HINT_REQUESTED,
      payload: { intent, conversationId },
    })
    .catch((error) => console.error("[mentor] failed to publish AI_HINT_REQUESTED:", error.message));
};

const getOrCreateConversation = async (actor, conversationId, firstMessage) => {
  if (conversationId) {
    const conversation = await mentorConversationRepository.findById(conversationId);
    assertOwnsConversation(actor, conversation);
    return conversation;
  }
  const conversation = await mentorConversationRepository.create(actor.userId, actor.role);
  await mentorConversationRepository.touch(conversation.id, { title: firstMessage.slice(0, 80) });
  return conversation;
};

/** After a turn: persists both messages, the context snapshot, the invocation ledger, updates memory, and re-summarizes if the conversation crossed the compaction threshold. Shared by both chat() and streamChat(). */
const persistTurn = async (actor, conversation, userMessage, turnResult) => {
  const userMessageRow = await mentorMessageRepository.create(conversation.id, {
    role: MESSAGE_ROLE.USER,
    content: userMessage,
    intent: turnResult.intentResult.intent,
    intentConfidence: turnResult.intentResult.confidence,
  });

  const assistantMessageRow = await mentorMessageRepository.create(conversation.id, {
    role: MESSAGE_ROLE.ASSISTANT,
    content: turnResult.reply.text,
    metadata: { model: turnResult.reply.model, inputTokens: turnResult.reply.inputTokens, outputTokens: turnResult.reply.outputTokens },
  });

  await mentorConversationRepository.touch(conversation.id, { lastIntent: turnResult.intentResult.intent });

  const agentsQueried = turnResult.agentResults.map((r) => ({ agentName: r.agentName, method: r.method, status: r.status }));

  if (!turnResult.isClarifyingQuestion) {
    if (turnResult.mergedContext) {
      await conversationContextRepository.create(conversation.id, assistantMessageRow.id, turnResult.mergedContext.byAgent, agentsQueried);
    }
    if (turnResult.agentResults.length > 0) {
      await agentInvocationRepository.createMany(conversation.id, assistantMessageRow.id, turnResult.agentResults);
    }

    const facts = memory.extractFacts(turnResult.intentResult, turnResult.mergedContext, userMessage);
    await mentorMemoryRepository.upsertMany(actor.userId, facts);

    const messageCount = await mentorMessageRepository.countByConversation(conversation.id);
    if (memory.shouldSummarize(messageCount)) {
      const allMessages = await mentorMessageRepository.findByConversation(conversation.id);
      const summary = await memory.summarizeOlderMessages(allMessages);
      if (summary) await conversationSummaryRepository.upsert(conversation.id, { ...summary, messageCountAtSummary: messageCount });
    }
  }

  publishAiHintEvent(actor, turnResult.intentResult.intent, conversation.id);

  return { userMessageRow, assistantMessageRow, agentsQueried };
};

/** POST /mentor/chat */
const chat = async (actor, { conversationId, message }) => {
  const conversation = await getOrCreateConversation(actor, conversationId, message);
  const turnResult = await orchestrator.runTurn(actor, conversation.id, message);
  const { userMessageRow, assistantMessageRow, agentsQueried } = await persistTurn(actor, conversation, message, turnResult);

  return toChatResponse({
    conversationId: conversation.id,
    userMessage: userMessageRow,
    assistantMessage: assistantMessageRow,
    intentResult: turnResult.intentResult,
    agentsQueried,
  });
};

/**
 * POST /mentor/stream — same pipeline as chat(), but the LLM call streams
 * real token deltas through onChunk as they arrive (or the fallback text
 * as one chunk when no LLM is configured — see llm/index.js#streamReply).
 * Persistence happens once the full reply text is known, same as chat().
 *
 * @param {(textDelta: string) => void} onChunk
 */
const streamChat = async (actor, { conversationId, message }, onChunk) => {
  const conversation = await getOrCreateConversation(actor, conversationId, message);
  const turnResult = await orchestrator.runTurn(actor, conversation.id, message, onChunk);
  const { userMessageRow, assistantMessageRow, agentsQueried } = await persistTurn(actor, conversation, message, turnResult);

  return toChatResponse({
    conversationId: conversation.id,
    userMessage: userMessageRow,
    assistantMessage: assistantMessageRow,
    intentResult: turnResult.intentResult,
    agentsQueried,
  });
};

/** GET /mentor/history */
const getHistory = async (actor, { page = 1, limit = HISTORY_PAGE_SIZE } = {}) => {
  const [conversations, total] = await Promise.all([
    mentorConversationRepository.findByUser(actor.userId, { page, limit }),
    mentorConversationRepository.countByUser(actor.userId),
  ]);
  return toHistoryResponse(conversations, total, page, limit);
};

/** GET /mentor/context — live read, no persistence, no LLM call. */
const getContext = async (actor) => toContextResponse(await orchestrator.gatherContextOnly(actor));

/** GET /mentor/recommendations */
const getRecommendations = async (actor) => toRecommendationsResponse(await orchestrator.gatherContextOnly(actor));

/** GET /mentor/conversation/:id */
const getConversationDetail = async (actor, conversationId) => {
  const conversation = await mentorConversationRepository.findById(conversationId);
  assertOwnsConversation(actor, conversation);
  const messages = await mentorMessageRepository.findByConversation(conversationId);
  return toConversationDetailResponse(conversation, messages);
};

/** DELETE /mentor/conversation/:id — this agent's own data only, real delete (not another agent's records). */
const deleteConversation = async (actor, conversationId) => {
  const conversation = await mentorConversationRepository.findById(conversationId);
  assertOwnsConversation(actor, conversation);
  await mentorConversationRepository.remove(conversationId);
  return { id: conversationId, deleted: true };
};

/** POST /mentor/feedback */
const submitFeedback = async (actor, { messageId, rating, comment }) => {
  const message = await mentorMessageRepository.findById(messageId);
  if (!message) throw new ApiError(404, "Message not found");

  const conversation = await mentorConversationRepository.findById(message.conversationId);
  assertOwnsConversation(actor, conversation);

  if (message.role !== MESSAGE_ROLE.ASSISTANT) throw new ApiError(400, "Feedback can only be given on the mentor's own replies");

  const existing = await responseFeedbackRepository.findByMessage(messageId);
  if (existing) throw new ApiError(409, "Feedback has already been submitted for this message");

  const feedback = await responseFeedbackRepository.create(messageId, actor.userId, rating, comment);
  return toFeedbackResponse(feedback);
};

module.exports = { chat, streamChat, getHistory, getContext, getRecommendations, getConversationDetail, deleteConversation, submitFeedback };
