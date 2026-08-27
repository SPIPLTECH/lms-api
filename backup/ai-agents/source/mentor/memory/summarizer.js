const llm = require("../llm");
const { SUMMARY_TRIGGER_MESSAGE_COUNT, RECENT_MESSAGES_VERBATIM_COUNT } = require("../constants");

const shouldSummarize = (messageCount) => messageCount >= SUMMARY_TRIGGER_MESSAGE_COUNT;

/**
 * Deterministic extractive fallback — a real, non-fabricated summary (which
 * intents were discussed, how many turns) rather than fake prose, used
 * whenever no LLM is configured. Same "honest non-generative default"
 * pattern as llm/fallbackProvider.js.
 *
 * @param {{role: string, intent: string|null, content: string}[]} messagesToFold
 */
const buildExtractiveSummary = (messagesToFold) => {
  const userMessages = messagesToFold.filter((m) => m.role === "USER");
  const intents = [...new Set(userMessages.map((m) => m.intent).filter(Boolean))];
  const topics = userMessages.slice(0, 5).map((m) => m.content.slice(0, 80));

  return {
    summaryText: `${userMessages.length} earlier message(s) covering: ${intents.join(", ") || "general questions"}.`,
    keyTopics: topics,
  };
};

/**
 * @param {{role: string, intent: string|null, content: string}[]} allMessages - oldest first
 * @param {string|null} existingSummaryText
 */
const summarizeOlderMessages = async (allMessages) => {
  const messagesToFold = allMessages.slice(0, allMessages.length - RECENT_MESSAGES_VERBATIM_COUNT);
  if (messagesToFold.length === 0) return null;

  if (!llm.isConfigured()) {
    return buildExtractiveSummary(messagesToFold);
  }

  const transcript = messagesToFold.map((m) => `${m.role}: ${m.content}`).join("\n");
  try {
    const result = await llm.generateReply({
      systemPrompt: "Summarize this LMS mentor conversation in 2-3 sentences, focused on what the user was trying to accomplish. Be factual, don't add advice.",
      messages: [{ role: "user", content: transcript }],
      fallbackNotice: "",
      mergedContext: { rankedSuggestions: [], notifications: [], recentActivity: [] },
    });
    const extractive = buildExtractiveSummary(messagesToFold);
    return { summaryText: result.text, keyTopics: extractive.keyTopics };
  } catch (error) {
    console.error("[mentor:summarizer] LLM summarization failed, falling back to extractive summary:", error.message);
    return buildExtractiveSummary(messagesToFold);
  }
};

module.exports = { shouldSummarize, summarizeOlderMessages, buildExtractiveSummary };
