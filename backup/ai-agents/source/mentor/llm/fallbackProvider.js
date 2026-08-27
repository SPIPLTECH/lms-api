/**
 * Deterministic, non-generative reply used when no LLM is configured — the
 * same "real seam, honest empty default" pattern as anthropicProvider.js's
 * own doc comment describes, applied to the response itself: every line
 * here is a real fact already gathered in mergedContext, never invented
 * prose. Always prefixed with the FALLBACK_NOTICE template text so this is
 * never mistaken for genuine LLM reasoning.
 *
 * @param {{fallbackNotice: string, mergedContext: import("../types/mentor.types").MergedContext}} input
 * @returns {{text: string, model: string, inputTokens: number, outputTokens: number}}
 */
const buildFallbackReply = ({ fallbackNotice, mergedContext }) => {
  const lines = [fallbackNotice, ""];

  if (mergedContext.rankedSuggestions.length > 0) {
    lines.push("Here's what your learning agents currently suggest, highest priority first:");
    for (const suggestion of mergedContext.rankedSuggestions.slice(0, 5)) {
      lines.push(`- [${suggestion.source}] ${suggestion.title}`);
    }
    lines.push("");
  }

  if (mergedContext.notifications.length > 0) {
    lines.push(`You have ${mergedContext.notifications.length} unread notification(s).`);
  }

  if (mergedContext.recentActivity.length > 0) {
    lines.push(`Your ${mergedContext.recentActivity.length} most recent activity event(s) were gathered for this reply.`);
  }

  if (mergedContext.rankedSuggestions.length === 0 && mergedContext.notifications.length === 0 && mergedContext.recentActivity.length === 0) {
    lines.push("I couldn't find any relevant data from your learning agents for this question yet.");
  }

  return { text: lines.join("\n").trim(), model: "fallback", inputTokens: 0, outputTokens: 0 };
};

module.exports = { buildFallbackReply };
