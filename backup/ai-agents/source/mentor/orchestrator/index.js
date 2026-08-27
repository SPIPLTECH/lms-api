const { classifyIntent, isBelowConfidenceThreshold } = require("../intent-engine");
const { mergeContext, gatherNotifications, gatherCalendarEvents } = require("../context-engine");
const { selectAgentCalls } = require("./agentSelector");
const { safeInvokeAll } = require("../utils/safeInvoke.util");
const { buildSystemPrompt, buildMessages } = require("../prompt-builder");
const llm = require("../llm");

const mentorMessageRepository = require("../repositories/mentorMessage.repository");
const mentorMemoryRepository = require("../repositories/mentorMemory.repository");
const conversationSummaryRepository = require("../repositories/conversationSummary.repository");
const promptTemplateRepository = require("../repositories/promptTemplate.repository");

const { RECENT_MESSAGES_VERBATIM_COUNT, INTENT } = require("../constants");

/**
 * The pipeline coordinator — implements the spec's own diagram exactly:
 *
 *   Intent Detection -> Context Collection -> Agent Selection ->
 *   Parallel Agent Execution -> Merge Results -> Reasoning Layer ->
 *   Prompt Construction -> Generate Final Response
 *
 * ("Store Conversation" is the one step this function does NOT do — that's
 * services/mentor.service.js's job, once it has the result to persist.
 * Keeping this function read-only/side-effect-free on the DB besides the
 * peer-agent reads makes it independently testable and keeps a clean
 * Reasoning-Layer/Persistence-Layer boundary.)
 *
 * @param {import("../types/mentor.types").Actor} actor
 * @param {string} conversationId
 * @param {string} userMessage
 * @param {(textDelta: string) => void} [onChunk] - if provided, uses streaming generation
 */
const runTurn = async (actor, conversationId, userMessage, onChunk) => {
  // 1. Intent Detection
  const intentResult = classifyIntent(userMessage);

  // Below-threshold short-circuit: no agent calls, no LLM call — a
  // clarifying question is itself a legitimate, honest response.
  if (isBelowConfidenceThreshold(intentResult)) {
    const clarifyingTemplate = await promptTemplateRepository.findByKey("CLARIFYING_QUESTION");
    return {
      intentResult,
      agentResults: [],
      mergedContext: null,
      reply: { text: clarifyingTemplate?.template || "Could you tell me more about what you need help with?", model: "clarifying-question", inputTokens: 0, outputTokens: 0 },
      isClarifyingQuestion: true,
    };
  }

  // 2 & 3. Context Collection + Agent Selection (declarative, see agentSelector.js)
  const agentDescriptors = selectAgentCalls(actor, intentResult.intent);

  // 4. Parallel Agent Execution — peer-agent calls and this LMS's own raw
  // context reads run concurrently; neither depends on the other's result.
  const [agentResults, notifications, calendarEvents] = await Promise.all([
    safeInvokeAll(agentDescriptors),
    gatherNotifications(actor.userId),
    gatherCalendarEvents(),
  ]);

  // 5. Merge Results
  const mergedContext = mergeContext(actor, agentResults, { notifications, calendarEvents });

  // Conversation memory: recent verbatim turns + compacted summary + cross-conversation facts.
  const [recentMessages, summary, memoryRows, systemTemplate] = await Promise.all([
    mentorMessageRepository.findRecentByConversation(conversationId, RECENT_MESSAGES_VERBATIM_COUNT),
    conversationSummaryRepository.findByConversation(conversationId),
    mentorMemoryRepository.findAllByUser(actor.userId),
    promptTemplateRepository.findByRole(actor.role),
  ]);

  const memoryFacts = Object.fromEntries(memoryRows.map((row) => [row.memoryKey, row.value]));

  // 6. Reasoning Layer + 7. Prompt Construction
  const fallbackTemplate = await promptTemplateRepository.findByKey("FALLBACK_NOTICE");
  const systemPrompt = buildSystemPrompt(systemTemplate?.template || "You are a helpful AI mentor for an LMS.\n\nContext:\n{{context}}\n\nSummary:\n{{summary}}\n\nMemory:\n{{memory}}", mergedContext, {
    summaryText: summary?.summaryText || null,
    memoryFacts,
  });
  const messages = buildMessages(recentMessages, userMessage);

  // 8. Generate Final Response
  const reply = onChunk
    ? await llm.streamReply({ systemPrompt, messages, fallbackNotice: fallbackTemplate?.template || "", mergedContext }, onChunk)
    : await llm.generateReply({ systemPrompt, messages, fallbackNotice: fallbackTemplate?.template || "", mergedContext });

  return { intentResult, agentResults, mergedContext, reply, isClarifyingQuestion: false };
};

/**
 * Context Collection + Agent Selection + Merge only, no Reasoning
 * Layer/LLM call — backs GET /mentor/context and GET /mentor/recommendations,
 * neither of which needs a generated reply, just the real gathered data.
 * Uses GENERAL intent's agent set, which already includes each role's most
 * broadly useful getter (student-state/recommendation for STUDENT,
 * getTeacherDashboard for INSTRUCTOR, getDashboard for ADMIN — see
 * agentSelector.js, both are unconditionally included per role).
 *
 * @param {import("../types/mentor.types").Actor} actor
 */
const gatherContextOnly = async (actor) => {
  const agentDescriptors = selectAgentCalls(actor, INTENT.GENERAL);
  const [agentResults, notifications, calendarEvents] = await Promise.all([
    safeInvokeAll(agentDescriptors),
    gatherNotifications(actor.userId),
    gatherCalendarEvents(),
  ]);
  return mergeContext(actor, agentResults, { notifications, calendarEvents });
};

module.exports = { runTurn, gatherContextOnly };
