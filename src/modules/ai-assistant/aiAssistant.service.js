const crypto = require("crypto");
const prisma = require("../../config/database");
const ApiError = require("../../utils/ApiError");
const llmService = require("../llm/llm.service");

const { SCOPE, MESSAGE_ROLE, LIMITS } = require("./constants/aiAssistant.constants");
const { resolveScope } = require("./access/resolveScope");
const { validateLearningPosition, isSecurityViolation } = require("./access/validateHierarchy");
const { select } = require("./retrieval/contentSelector");
const { getSystemPrompt } = require("./prompts/scoped.prompts");
const { buildTurn } = require("./prompts/userPrompt.builder");

const newRequestId = () => crypto.randomUUID();

/**
 * Structured, greppable log line. Deliberately records ids and counts, never
 * message bodies, retrieved course text, prompts, or the API key.
 */
const logTurn = (fields) => {
  console.log("[ai-assistant] " + JSON.stringify(fields));
};

/* ------------------------------------------------------------------ */
/* Conversations                                                       */
/* ------------------------------------------------------------------ */

/**
 * Loads a conversation and asserts the caller owns it.
 * No admin override: this is a personal assistant surface, not an
 * institutional record. User A must never read User B's conversation.
 */
const getOwnedConversation = async (userId, conversationId) => {
  if (!userId) throw new ApiError(401, "Authentication required.");

  const conversation = await prisma.aiConversation.findUnique({
    where: { id: conversationId },
  });

  if (!conversation) throw new ApiError(404, "Conversation not found.");
  if (conversation.userId !== userId) {
    // Same status and message as a genuine miss, so the endpoint cannot be
    // used to probe which conversation ids exist.
    throw new ApiError(404, "Conversation not found.");
  }
  return conversation;
};

const createConversation = async (user, { title, courseId } = {}) => {
  if (!user || !user.id) throw new ApiError(401, "Authentication required.");

  // A conversation may only be pinned to a course the user can actually
  // reach; resolveScope throws for a missing or non-public course.
  if (courseId) await resolveScope(user, courseId);

  return prisma.aiConversation.create({
    data: {
      userId: user.id,
      courseId: courseId || null,
      title: title ? title.slice(0, LIMITS.MAX_TITLE_CHARS) : null,
    },
  });
};

const listConversations = async (user, { courseId, status } = {}) => {
  if (!user || !user.id) throw new ApiError(401, "Authentication required.");

  return prisma.aiConversation.findMany({
    where: {
      userId: user.id,
      ...(courseId ? { courseId } : {}),
      ...(status ? { status } : {}),
    },
    orderBy: { lastMessageAt: "desc" },
    take: LIMITS.CONVERSATION_PAGE_SIZE,
    select: {
      id: true,
      title: true,
      courseId: true,
      status: true,
      lastMessageAt: true,
      createdAt: true,
      course: { select: { id: true, title: true } },
    },
  });
};

const getMessages = async (user, conversationId) => {
  await getOwnedConversation(user && user.id, conversationId);
  return prisma.aiMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" },
    select: { id: true, role: true, content: true, createdAt: true },
  });
};

const updateConversation = async (user, conversationId, { title, status }) => {
  await getOwnedConversation(user && user.id, conversationId);
  return prisma.aiConversation.update({
    where: { id: conversationId },
    data: {
      ...(title !== undefined
        ? { title: title ? title.slice(0, LIMITS.MAX_TITLE_CHARS) : null }
        : {}),
      ...(status !== undefined ? { status } : {}),
    },
  });
};

const deleteConversation = async (user, conversationId) => {
  await getOwnedConversation(user && user.id, conversationId);
  // AiMessage rows cascade via the foreign key.
  await prisma.aiConversation.delete({ where: { id: conversationId } });
  return { id: conversationId };
};

/* ------------------------------------------------------------------ */
/* Turn preparation                                                    */
/* ------------------------------------------------------------------ */

/**
 * Authorization -> retrieval -> prompt, in that fixed order.
 *
 * Nothing the client sent is used as a grant. `courseId` only selects which
 * course resolveScope evaluates; the position ids are filtered down to what
 * actually belongs to that course; and the scope that comes back is what
 * chooses the retriever and the persona.
 */
const prepareTurn = async ({ user, courseId, position, message, history, requestId }) => {
  const resolved = await resolveScope(user, courseId || null);

  let validPosition = { moduleId: null, lessonId: null, topicId: null, contentIds: [] };
  let violations = [];

  // A learning position only means anything for a scope allowed to see
  // content; for GUEST/BROWSING the ids are never even resolved.
  if (resolved.scope === SCOPE.ENROLLED && resolved.courseId) {
    const validated = await validateLearningPosition(resolved.courseId, position || {});
    violations = validated.violations;
    validPosition = {
      moduleId: validated.moduleId,
      lessonId: validated.lessonId,
      topicId: validated.topicId,
      contentIds: validated.contentIds,
    };
  } else if (position && Object.keys(position).length > 0) {
    // Learning-position ids arrived from a caller with no content access.
    // Nothing is retrieved, but it is worth seeing in the logs.
    violations = [{ kind: "position", id: null, reason: "IGNORED_UNPRIVILEGED_SCOPE" }];
  }

  const securityEvents = violations.filter(isSecurityViolation);
  if (securityEvents.length > 0) {
    console.warn(
      "[ai-assistant][security] " +
        JSON.stringify({
          requestId,
          userId: resolved.userId,
          scope: resolved.scope,
          courseId: resolved.courseId,
          violations: securityEvents,
        })
    );
  }

  const retrieval = await select({
    scope: resolved.scope,
    courseId: resolved.courseId,
    position: validPosition,
    budget: LIMITS.MAX_CONTEXT_CHARS,
  });

  return {
    resolved,
    validPosition,
    violations,
    retrieval,
    systemPrompt: getSystemPrompt(resolved.scope),
    userPrompt: buildTurn({ message, history, contextChunks: retrieval.chunks }),
  };
};

/* ------------------------------------------------------------------ */
/* Streaming turn                                                      */
/* ------------------------------------------------------------------ */

/**
 * Runs one streamed turn.
 *
 * Persistence differs deliberately by scope: an authenticated turn writes
 * both messages, a guest turn writes nothing at all — guest chat is stateless
 * by design, so there is no anonymous row to own, expire or leak.
 *
 * The user message is written BEFORE generation, unlike the old Mentor, which
 * wrote both afterwards and so lost the student's own message whenever the
 * model call failed.
 */
const streamTurn = async ({ user, conversationId, message, courseId, position, onToken, signal }) => {
  const requestId = newRequestId();
  const startedAt = Date.now();
  const isGuest = !user || !user.id;

  let conversation = null;
  let history = [];
  let effectiveCourseId = courseId || null;

  if (!isGuest) {
    conversation = await getOwnedConversation(user.id, conversationId);
    // A conversation already pinned to a course wins over whatever the client
    // sent, so a request cannot re-point an existing thread at another course.
    effectiveCourseId = conversation.courseId || courseId || null;

    const prior = await prisma.aiMessage.findMany({
      where: { conversationId },
      orderBy: { createdAt: "desc" },
      take: LIMITS.HISTORY_TURNS,
      select: { role: true, content: true },
    });
    history = prior.reverse();
  }

  const prepared = await prepareTurn({
    user,
    courseId: effectiveCourseId,
    position,
    message,
    history,
    requestId,
  });

  if (!isGuest) {
    await prisma.aiMessage.create({
      data: { conversationId, role: MESSAGE_ROLE.USER, content: message },
    });
    // The first message of a thread names it, so history stays scannable.
    if (!conversation.title) {
      const derived = message.trim().slice(0, 60);
      await prisma.aiConversation.update({
        where: { id: conversationId },
        data: { title: derived || null },
      });
    }
  }

  let result;
  try {
    result = await llmService.generateStream({
      provider: "gemini", // The AI Assistant is Gemini-only. Never Ollama.
      systemPrompt: prepared.systemPrompt,
      prompt: prepared.userPrompt,
      responseMimeType: "text/plain",
      maxOutputTokens: LIMITS.MAX_OUTPUT_TOKENS,
      onToken,
      signal,
    });
  } catch (error) {
    logTurn({
      requestId,
      event: "turn.failed",
      scope: prepared.resolved.scope,
      userId: prepared.resolved.userId,
      courseId: prepared.resolved.courseId,
      latencyMs: Date.now() - startedAt,
      errorCode: error.code || "UNKNOWN",
      aborted: Boolean(error.isAbort),
    });
    error.requestId = requestId;
    throw error;
  }

  if (!isGuest) {
    await prisma.aiMessage.create({
      data: {
        conversationId,
        role: MESSAGE_ROLE.ASSISTANT,
        content: result.response,
        metadata: {
          requestId,
          scope: prepared.resolved.scope,
          model: result.model,
          usage: result.usage,
          latencyMs: Date.now() - startedAt,
          finishReason: result.finishReason,
          retrievalSourceIds: prepared.retrieval.sourceIds,
          contextChars: prepared.retrieval.totalChars,
        },
      },
    });
    await prisma.aiConversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: new Date() },
    });
  }

  logTurn({
    requestId,
    event: "turn.ok",
    scope: prepared.resolved.scope,
    userId: prepared.resolved.userId,
    courseId: prepared.resolved.courseId,
    model: result.model,
    latencyMs: Date.now() - startedAt,
    promptTokens: (result.usage && result.usage.promptTokens) || null,
    outputTokens: (result.usage && result.usage.outputTokens) || null,
    contextChars: prepared.retrieval.totalChars,
    retrievedCount: prepared.retrieval.chunks.length,
    droppedChunks: prepared.retrieval.droppedCount,
    persisted: !isGuest,
  });

  return {
    requestId,
    conversationId: isGuest ? null : conversationId,
    scope: prepared.resolved.scope,
    model: result.model,
  };
};

module.exports = {
  createConversation,
  listConversations,
  getMessages,
  updateConversation,
  deleteConversation,
  getOwnedConversation,
  prepareTurn,
  streamTurn,
};
