const ollamaClient = require("./ollama.client");
const llmConfig = require("./llm.config");

const buildPromptWithContext = (prompt, context) => {
  if (!context || typeof context !== "object" || Object.keys(context).length === 0) {
    return prompt;
  }

  return `${prompt}\n\nContext:\n${JSON.stringify(context, null, 2)}`;
};

const toNullableNumber = (value) => (typeof value === "number" ? value : null);

// Ollama reports durations in nanoseconds; the rest of the app works in ms.
const nsToMs = (nanoseconds) =>
  typeof nanoseconds === "number" ? Math.round(nanoseconds / 1e6) : null;

// The provider-independent LLM Gateway. This is the only entry point the
// rest of the application should ever call to reach an LLM.
const generate = async ({ systemPrompt, prompt, context, think = false } = {}) => {
  const result = await ollamaClient.chat({
    systemPrompt,
    prompt: buildPromptWithContext(prompt, context),
    think: Boolean(think),
  });

  const promptTokens = toNullableNumber(result.prompt_eval_count);
  const outputTokens = toNullableNumber(result.eval_count);
  const totalTokens =
    promptTokens !== null && outputTokens !== null ? promptTokens + outputTokens : null;

  return {
    response: result.message.content,
    usage: {
      promptTokens,
      outputTokens,
      totalTokens,
    },
    latency: {
      totalMs: nsToMs(result.total_duration),
      loadMs: nsToMs(result.load_duration),
      evalMs: nsToMs(result.eval_duration),
    },
    model: result.model || llmConfig.model,
    thinkingEnabled: Boolean(think),
  };
};

// Streaming counterpart to generate(). Same prompt assembly and same
// normalized return shape ({ response, usage, latency, model,
// thinkingEnabled }) — the only difference is that `onToken` fires with each
// content delta as Ollama produces it, and `response` is the concatenation
// of everything forwarded to `onToken` rather than one final blob.
const generateStream = async ({ systemPrompt, prompt, context, think = false, onToken, signal } = {}) => {
  let fullText = "";
  const handleToken = (token) => {
    fullText += token;
    if (typeof onToken === "function") {
      onToken(token);
    }
  };

  const result = await ollamaClient.chatStream({
    systemPrompt,
    prompt: buildPromptWithContext(prompt, context),
    think: Boolean(think),
    onToken: handleToken,
    signal,
  });

  const promptTokens = toNullableNumber(result.prompt_eval_count);
  const outputTokens = toNullableNumber(result.eval_count);
  const totalTokens =
    promptTokens !== null && outputTokens !== null ? promptTokens + outputTokens : null;

  return {
    response: fullText,
    usage: {
      promptTokens,
      outputTokens,
      totalTokens,
    },
    latency: {
      totalMs: nsToMs(result.total_duration),
      loadMs: nsToMs(result.load_duration),
      evalMs: nsToMs(result.eval_duration),
    },
    model: result.model || llmConfig.model,
    thinkingEnabled: Boolean(think),
  };
};

module.exports = { generate, generateStream };
