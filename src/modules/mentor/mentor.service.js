const prisma = require("../../config/database");
const ApiError = require("../../utils/ApiError");
const llmService = require("../llm/llm.service");
const toolRegistry = require("./tools/tool.registry");
const { buildSystemPrompt, buildUserPrompt } = require("./mentorPrompt.builder");

/**
 * Creates a new MentorConversation for the authenticated user.
 */
const createConversation = async (user, title) => {
  if (!user || !user.id || !user.role) {
    throw new ApiError(401, "User authentication required");
  }

  const conversation = await prisma.mentorConversation.create({
    data: {
      userId: user.id,
      userRole: user.role,
      title: title || "Learning Mentor Session",
      status: "ACTIVE",
    },
  });

  return conversation;
};

/**
 * Retrieves all MentorConversations for the authenticated user.
 */
const getUserConversations = async (user) => {
  if (!user || !user.id) {
    throw new ApiError(401, "User authentication required");
  }

  return await prisma.mentorConversation.findMany({
    where: { userId: user.id },
    orderBy: { lastMessageAt: "desc" },
  });
};

/**
 * Verifies conversation ownership and retrieves conversation messages.
 */
const getConversationMessages = async (user, conversationId) => {
  if (!user || !user.id) {
    throw new ApiError(401, "User authentication required");
  }

  const conversation = await prisma.mentorConversation.findUnique({
    where: { id: conversationId },
  });

  if (!conversation) {
    throw new ApiError(404, "Conversation not found");
  }

  if (conversation.userId !== user.id) {
    throw new ApiError(403, "Access denied: You do not own this conversation");
  }

  return await prisma.mentorMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" },
  });
};

/**
 * Lightweight role-specific intent classifier.
 * Returns valid Prisma MentorIntent enum values:
 * LEARNING, ASSESSMENT, RECOMMENDATION, ANALYTICS
 */
const determineIntent = (content, params = {}, userRole = "STUDENT") => {
  const lower = content.toLowerCase();
  const { quizId, courseId } = params;

  if (userRole === "ADMIN") {
    if (lower.includes("user") || lower.includes("users count") || lower.includes("students vs instructors")) {
      return { intent: "ANALYTICS", toolName: "getPlatformUsersSummary", confidence: 90 };
    }
    if (
      lower.includes("course summary") ||
      lower.includes("all courses") ||
      lower.includes("published vs draft") ||
      lower.includes("course statistics") ||
      lower.includes("course stats")
    ) {
      return { intent: "ANALYTICS", toolName: "getPlatformCourseSummary", confidence: 90 };
    }
    if (lower.includes("platform") || lower.includes("overview") || lower.includes("system stats")) {
      return { intent: "ANALYTICS", toolName: "getPlatformOverview", confidence: 90 };
    }
  }

  if (userRole === "INSTRUCTOR") {
    if (quizId || lower.includes("quiz result") || lower.includes("quiz score") || lower.includes("results analytics")) {
      return { intent: "ASSESSMENT", toolName: "getCourseResultsAnalytics", confidence: 90 };
    }
    if (lower.includes("enrolled student") || lower.includes("student list") || lower.includes("roster") || lower.includes("who is enrolled")) {
      return { intent: "ANALYTICS", toolName: "getCourseStudents", confidence: 90 };
    }
    if (
      courseId ||
      lower.includes("instructor analytics") ||
      lower.includes("course performance") ||
      lower.includes("my teaching stats") ||
      lower.includes("how many courses") ||
      lower.includes("courses do i own") ||
      lower.includes("courses i own") ||
      lower.includes("list my courses") ||
      lower.includes("list the courses") ||
      lower.includes("my courses")
    ) {
      return { intent: "ANALYTICS", toolName: "getMyInstructorAnalytics", confidence: 90 };
    }
  }

  // Default: STUDENT
  if (quizId || lower.includes("quiz result") || lower.includes("quiz score") || lower.includes("how did i do on quiz")) {
    return { intent: "ASSESSMENT", toolName: "getMyQuizResult", confidence: 95 };
  }

  if (
    lower.includes("dashboard") ||
    lower.includes("overall progress") ||
    lower.includes("my progress") ||
    lower.includes("completion rate") ||
    lower.includes("my stats") ||
    lower.includes("learning streak") ||
    lower.includes("how am i doing")
  ) {
    return { intent: "ANALYTICS", toolName: "getMyDashboardSummary", confidence: 90 };
  }

  if (
    lower.includes("knowledge gap") ||
    lower.includes("weak area") ||
    lower.includes("concept") ||
    lower.includes("mastery") ||
    lower.includes("learning state") ||
    lower.includes("topics to review") ||
    lower.includes("what should i focus") ||
    lower.includes("what should i study") ||
    lower.includes("study next") ||
    lower.includes("what to study")
  ) {
    return { intent: "RECOMMENDATION", toolName: "getMyLearnerState", confidence: 90 };
  }

  return { intent: "LEARNING", toolName: null, confidence: 100 };
};

/**
 * Common helper to verify ownership and prepare LLM execution payload
 */
const prepareExecution = async (user, conversationId, content, params = {}) => {
  if (!user || !user.id || !user.role) {
    throw new ApiError(401, "User authentication required");
  }

  const conversation = await prisma.mentorConversation.findUnique({
    where: { id: conversationId },
  });

  if (!conversation) {
    throw new ApiError(404, "Conversation not found");
  }

  if (conversation.userId !== user.id) {
    throw new ApiError(403, "Access denied: You do not own this conversation");
  }

  const { intent, toolName, confidence } = determineIntent(content, params, user.role);

  let toolData = null;
  if (toolName) {
    try {
      toolData = await toolRegistry.executeTool(toolName, user, params);
    } catch (err) {
      if (err.statusCode && err.statusCode !== 500) {
        // Re-throw explicit authorization/validation errors (e.g. 403 Access Denied)
        throw err;
      }
      // Log the real error server-side only -- never forward raw error text
      // (which can contain DB column/table names or other internals) into
      // the LLM context, since that gets echoed back to the end user.
      console.warn(`Tool execution warning (${toolName}):`, err.message);
      toolData = { toolError: "This information is temporarily unavailable." };
    }
  }

  const recentHistory = await prisma.mentorMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: "desc" },
    take: 6,
  });

  const formattedHistory = recentHistory.reverse().map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const systemPrompt = buildSystemPrompt(user.role);
  const userPrompt = buildUserPrompt({
    message: content,
    history: formattedHistory,
    context: toolData,
  });

  return {
    conversation,
    intent,
    confidence,
    systemPrompt,
    userPrompt,
  };
};

/**
 * Process a user message end-to-end (non-streaming)
 */
const processUserMessage = async (user, conversationId, content, params = {}) => {
  const prep = await prepareExecution(user, conversationId, content, params);

  const llmResult = await llmService.generate({
    systemPrompt: prep.systemPrompt,
    prompt: prep.userPrompt,
  });

  const userMsg = await prisma.mentorMessage.create({
    data: {
      conversationId,
      role: "USER",
      content,
      intent: prep.intent,
      intentConfidence: prep.confidence,
    },
  });

  const assistantMsg = await prisma.mentorMessage.create({
    data: {
      conversationId,
      role: "ASSISTANT",
      content: llmResult.response,
      metadata: {
        model: llmResult.model,
        usage: llmResult.usage,
        latency: llmResult.latency,
      },
    },
  });

  await prisma.mentorConversation.update({
    where: { id: conversationId },
    data: {
      lastMessageAt: new Date(),
      lastIntent: prep.intent,
    },
  });

  return {
    conversationId,
    intent: prep.intent,
    userMessage: userMsg,
    assistantMessage: assistantMsg,
  };
};

/**
 * Process a user message end-to-end with SSE Streaming
 */
const processUserMessageStream = async (user, conversationId, content, params = {}, { onToken, signal } = {}) => {
  const prep = await prepareExecution(user, conversationId, content, params);

  const llmResult = await llmService.generateStream({
    systemPrompt: prep.systemPrompt,
    prompt: prep.userPrompt,
    onToken,
    signal,
  });

  const userMsg = await prisma.mentorMessage.create({
    data: {
      conversationId,
      role: "USER",
      content,
      intent: prep.intent,
      intentConfidence: prep.confidence,
    },
  });

  const assistantMsg = await prisma.mentorMessage.create({
    data: {
      conversationId,
      role: "ASSISTANT",
      content: llmResult.response,
      metadata: {
        model: llmResult.model,
        usage: llmResult.usage,
        latency: llmResult.latency,
      },
    },
  });

  await prisma.mentorConversation.update({
    where: { id: conversationId },
    data: {
      lastMessageAt: new Date(),
      lastIntent: prep.intent,
    },
  });

  return {
    conversationId,
    intent: prep.intent,
    userMessage: userMsg,
    assistantMessage: assistantMsg,
  };
};

module.exports = {
  createConversation,
  getUserConversations,
  getConversationMessages,
  determineIntent,
  processUserMessage,
  processUserMessageStream,
};
