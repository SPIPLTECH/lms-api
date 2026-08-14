const anthropicProvider = require("./anthropicProvider");
const { buildFallbackReply } = require("./fallbackProvider");

/**
 * Single entry point the rest of this module calls — hides which provider
 * (real Anthropic call vs. deterministic fallback) actually produced a
 * reply. Every caller gets the same `{text, model, inputTokens,
 * outputTokens}` shape either way.
 *
 * @param {{systemPrompt: string, messages: object[], fallbackNotice: string, mergedContext: object}} input
 */
const generateReply = async ({ systemPrompt, messages, fallbackNotice, mergedContext }) => {
  if (anthropicProvider.isConfigured()) {
    return anthropicProvider.generate({ systemPrompt, messages });
  }
  return buildFallbackReply({ fallbackNotice, mergedContext });
};

/**
 * Streaming counterpart. When no LLM is configured, the fallback text is
 * sent as a single chunk — still a real SSE stream, just one event long,
 * rather than fabricating token-by-token pacing for non-generated text.
 *
 * @param {{systemPrompt: string, messages: object[], fallbackNotice: string, mergedContext: object}} input
 * @param {(textDelta: string) => void} onChunk
 */
const streamReply = async ({ systemPrompt, messages, fallbackNotice, mergedContext }, onChunk) => {
  if (anthropicProvider.isConfigured()) {
    return anthropicProvider.stream({ systemPrompt, messages }, onChunk);
  }
  const fallback = buildFallbackReply({ fallbackNotice, mergedContext });
  onChunk(fallback.text);
  return fallback;
};

module.exports = { generateReply, streamReply, isConfigured: anthropicProvider.isConfigured };
