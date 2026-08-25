const Anthropic = require("@anthropic-ai/sdk");
const { LLM_MODEL, LLM_MAX_TOKENS, LLM_TEMPERATURE } = require("../constants");

/**
 * Real LLM integration for entry-assessment question generation — the
 * "real adapter seam, honest empty default" pattern used throughout this
 * codebase's AI integrations.
 */
const isConfigured = () => Boolean(process.env.ANTHROPIC_API_KEY);

let client = null;
const getClient = () => {
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
};

/**
 * @param {{systemPrompt: string, userPrompt: string}} input
 * @returns {Promise<{text: string, model: string, inputTokens: number, outputTokens: number}>}
 */
const generate = async ({ systemPrompt, userPrompt }) => {
  const response = await getClient().messages.create({
    model: LLM_MODEL,
    max_tokens: LLM_MAX_TOKENS,
    temperature: LLM_TEMPERATURE,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");

  return { text, model: response.model, inputTokens: response.usage?.input_tokens ?? 0, outputTokens: response.usage?.output_tokens ?? 0 };
};

module.exports = { isConfigured, generate };
