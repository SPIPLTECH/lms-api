
const OpenAI = require("openai");

const getClient = () => {
  const apiKey = (process.env.GROQ_API_KEY || "").trim();

  if (!apiKey) {
    const err = new Error(
      "AI service is not configured. Missing GROQ_API_KEY."
    );
    err.statusCode = 502;
    err.code = "GEMINI_AUTH_ERROR";
    throw err;
  }

  return new OpenAI({
    apiKey,
    baseURL: "https://api.groq.com/openai/v1",
    timeout: Number(process.env.OPENAI_TIMEOUT_MS) || 120000,
    maxRetries: Number.isInteger(Number(process.env.OPENAI_MAX_RETRIES))
      ? Number(process.env.OPENAI_MAX_RETRIES)
      : 2,
  });
};

const getMaxOutputTokens = (size) => {
  const explicit = Number(process.env.OPENAI_MAX_OUTPUT_TOKENS);
  if (explicit > 0) return explicit;

  const normalizedSize = String(size || "MEDIUM").toUpperCase();

  if (normalizedSize === "SMALL") {
    return Number(process.env.OPENAI_MAX_OUTPUT_TOKENS_SMALL) || 8192;
  }

  if (normalizedSize === "LARGE") {
    return Number(process.env.OPENAI_MAX_OUTPUT_TOKENS_LARGE) || 32768;
  }

  return Number(process.env.OPENAI_MAX_OUTPUT_TOKENS_MEDIUM) || 32768;
};

const generate = async ({
  systemPrompt,
  prompt,
  context,
  size,
} = {}) => {
  const client = getClient();
  const model = (
    process.env.OPENAI_MODEL || "openai/gpt-oss-20b"
  ).trim();

  const fullPrompt =
    context &&
    typeof context === "object" &&
    Object.keys(context).length > 0
      ? `${prompt || ""}\n\nContext:\n${JSON.stringify(context, null, 2)}`
      : prompt || "";

  const startTime = Date.now();

  try {
    const response = await client.chat.completions.create({
      model,
      messages: [
        {
          role: "system",
          content: systemPrompt || "",
        },
        {
          role: "user",
          content:
            `${fullPrompt}\n\n` +
            "Output format: JSON. Return a valid JSON object only. " +
            "Do not include Markdown fences or explanatory text.",
        },
      ],
      max_completion_tokens: getMaxOutputTokens(size),
      response_format: { type: "json_object" },
    });

    const choice = response.choices?.[0];
    const text = choice?.message?.content || "";

    if (!text.trim()) {
      const err = new Error("Groq returned an empty response.");
      err.statusCode = 502;
      err.code = "GEMINI_EMPTY_RESPONSE";
      throw err;
    }

    const inputTokens =
      typeof response.usage?.prompt_tokens === "number"
        ? response.usage.prompt_tokens
        : null;

    const outputTokens =
      typeof response.usage?.completion_tokens === "number"
        ? response.usage.completion_tokens
        : null;

    return {
      response: text,
      usage: {
        promptTokens: inputTokens,
        outputTokens,
        totalTokens:
          typeof response.usage?.total_tokens === "number"
            ? response.usage.total_tokens
            : inputTokens !== null && outputTokens !== null
              ? inputTokens + outputTokens
              : null,
      },
      latency: { totalMs: Date.now() - startTime },
      model: response.model || model,
      finishReason: choice?.finish_reason || null,
      thinkingEnabled: false,
    };
  } catch (error) {
    if (error.code && error.statusCode) {
      throw error;
    }

    const status = Number(error.status || error.statusCode || 0);
    const message = String(error.message || "Groq request failed");
    const normalized = new Error(message);

    if (status === 401 || status === 403) {
      normalized.statusCode = 502;
      normalized.code = "GEMINI_AUTH_ERROR";
    } else if (status === 429) {
      normalized.statusCode = 429;
      normalized.code = "GEMINI_TRANSIENT_ERROR";
    } else if (
      status >= 500 ||
      error.name === "APIConnectionTimeoutError" ||
      error.code === "ETIMEDOUT"
    ) {
      normalized.statusCode = 503;
      normalized.code = "GEMINI_TRANSIENT_ERROR";
    } else {
      normalized.statusCode = status >= 400 ? 502 : 500;
      normalized.code = "GEMINI_NON_RETRYABLE_ERROR";
    }

    const details =
  error.error ||
  error.response?.data?.error ||
  error.response?.data ||
  {};

console.error("[Groq Provider] Request failed:", {
  status: status || undefined,
  code: error.code,
  message,
  failedGeneration:
    details.failed_generation ||
    details.error?.failed_generation ||
    null,
  errorType: details.type || null,
});

    normalized.originalError = error;
    throw normalized;
  }
};

module.exports = { generate };
