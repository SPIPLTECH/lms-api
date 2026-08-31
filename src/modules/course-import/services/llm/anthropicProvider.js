const Anthropic = require("@anthropic-ai/sdk");
const { LLM_MODEL, LLM_MAX_TOKENS, LLM_TEMPERATURE } = require("../../constants");

/**
 * Same "real adapter seam, honest empty default" pattern as
 * mentor/llm/anthropicProvider.js and assessment/llm/anthropicProvider.js —
 * own copy per this codebase's per-module-independence convention, not a
 * shared import.
 */
const isConfigured = () => Boolean(process.env.ANTHROPIC_API_KEY);

let client = null;
const getClient = () => {
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
};

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

module.exports = { isConfigured, generate };
