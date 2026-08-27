const Anthropic = require("@anthropic-ai/sdk");
const { LLM_MODEL, LLM_MAX_TOKENS, LLM_TEMPERATURE } = require("../constants");

/**
 * Real LLM integration — only active when ANTHROPIC_API_KEY is set. This is
 * the same "real adapter seam, honest empty default" pattern Placement's
 * jobPortalProvider.js and Career's jobMarketProvider.js already
 * established for external integrations this LMS doesn't have live
 * credentials for: the seam is real and production-ready, it's just
 * unconfigured until a key is provided (see llm/index.js for the fallback
 * that takes over when it isn't).
 */
const isConfigured = () => Boolean(process.env.ANTHROPIC_API_KEY);

let client = null;
const getClient = () => {
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
};

/**
 * @param {{systemPrompt: string, messages: {role: "user"|"assistant", content: string}[]}} input
 * @returns {Promise<{text: string, model: string, inputTokens: number, outputTokens: number}>}
 */
const generate = async ({ systemPrompt, messages }) => {
  const response = await getClient().messages.create({
    model: LLM_MODEL,
    max_tokens: LLM_MAX_TOKENS,
    temperature: LLM_TEMPERATURE,
    system: systemPrompt,
    messages,
  });

  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");

  return { text, model: response.model, inputTokens: response.usage?.input_tokens ?? 0, outputTokens: response.usage?.output_tokens ?? 0 };
};

/**
 * Streams real token deltas via a callback — matches this codebase's
 * existing callback conventions (no async-generator usage anywhere else in
 * this repo). Resolves with the same shape `generate()` returns once the
 * stream completes, so callers can persist the full message either way.
 *
 * @param {{systemPrompt: string, messages: {role: "user"|"assistant", content: string}[]}} input
 * @param {(textDelta: string) => void} onChunk
 */
const stream = async ({ systemPrompt, messages }, onChunk) => {
  const anthropicStream = getClient().messages.stream({
    model: LLM_MODEL,
    max_tokens: LLM_MAX_TOKENS,
    temperature: LLM_TEMPERATURE,
    system: systemPrompt,
    messages,
  });

  anthropicStream.on("text", (textDelta) => onChunk(textDelta));

  const finalMessage = await anthropicStream.finalMessage();
  const text = finalMessage.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");

  return {
    text,
    model: finalMessage.model,
    inputTokens: finalMessage.usage?.input_tokens ?? 0,
    outputTokens: finalMessage.usage?.output_tokens ?? 0,
  };
};

module.exports = { isConfigured, generate, stream };
