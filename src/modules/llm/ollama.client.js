const axios = require("axios");

const ApiError = require("../../utils/ApiError");
const llmConfig = require("./llm.config");

const buildMessages = (systemPrompt, prompt) => {
  const messages = [];

  if (systemPrompt) {
    messages.push({ role: "system", content: systemPrompt });
  }

  messages.push({ role: "user", content: prompt });

  return messages;
};

const normalizeOllamaError = (error) => {
  if (error.code === "ECONNABORTED" || error.code === "ETIMEDOUT") {
    return new ApiError(504, "LLM request timed out");
  }

  if (!error.response) {
    return new ApiError(503, "LLM service is unavailable");
  }

  const { status, data } = error.response;
  const upstreamMessage = typeof data?.error === "string" ? data.error : "";

  if (status === 404 || upstreamMessage.toLowerCase().includes("not found")) {
    return new ApiError(404, `LLM model "${llmConfig.model}" not found`);
  }

  return new ApiError(502, "LLM service returned an error");
};

const normalizeOllamaResponse = (data) => {
  if (
    !data ||
    typeof data !== "object" ||
    typeof data.message?.content !== "string" ||
    data.message.content.trim() === ""
  ) {
    throw new ApiError(502, "Malformed response from LLM service");
  }

  return data;
};

// Ollama-specific request/response handling lives entirely in this file.
// Callers only ever see `chat()` and the normalized ApiError it can throw.
const chat = async ({ systemPrompt, prompt, think }) => {
  let response;
  const isThinking = Boolean(think);
  const timeout = isThinking ? llmConfig.thinkTimeoutMs : llmConfig.timeoutMs;

  const options = {
    num_predict: llmConfig.maxOutputTokens,
    temperature: 0.1
  };

  try {
    response = await axios.post(
      `${llmConfig.baseUrl}/api/chat`,
      {
        model: llmConfig.model,
        messages: buildMessages(systemPrompt, prompt),
        think: isThinking,
        format: "json",
        stream: false,
        options,
      },
      { timeout }
    );
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw normalizeOllamaError(error);
  }

  return normalizeOllamaResponse(response.data);
};

// Consumes Ollama's newline-delimited JSON stream (one JSON object per line,
// content deltas until the final line which carries done:true + the same
// stats fields normalizeOllamaResponse expects from the non-streaming call).
// Node Readable streams are async-iterable, so `for await` gives us chunks
// as they arrive without any extra stream-handling dependency.
const readOllamaStream = async ({ stream, onToken }) => {
  let buffer = "";
  let finalPayload = null;

  for await (const chunk of stream) {
    buffer += chunk.toString("utf8");

    let newlineIndex;
    while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (!line) continue;

      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }

      if (parsed.error) {
        throw new ApiError(502, parsed.error);
      }

      const token = parsed.message?.content;
      if (token) {
        onToken(token);
      }

      if (parsed.done) {
        finalPayload = parsed;
      }
    }
  }

  if (!finalPayload) {
    throw new ApiError(502, "LLM stream ended without a completion signal");
  }

  return finalPayload;
};

// Streaming counterpart to chat(). Same request shape, model, and timeout
// semantics — only `stream: true` and the response handling differ. Ollama
// content deltas are forwarded to `onToken` as they arrive instead of
// waiting for the full response body.
const chatStream = async ({ systemPrompt, prompt, think, onToken, signal }) => {
  const isThinking = Boolean(think);
  const timeout = isThinking ? llmConfig.thinkTimeoutMs : llmConfig.timeoutMs;

  const options = {};
  if (!isThinking) {
    options.num_predict = llmConfig.maxOutputTokens;
  }

  let response;
  try {
    response = await axios.post(
      `${llmConfig.baseUrl}/api/chat`,
      {
        model: llmConfig.model,
        messages: buildMessages(systemPrompt, prompt),
        think: isThinking,
        stream: true,
        ...(Object.keys(options).length > 0 ? { options } : {}),
      },
      { timeout, responseType: "stream", signal }
    );
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw normalizeOllamaError(error);
  }

  return readOllamaStream({ stream: response.data, onToken });
};

module.exports = { chat, chatStream };
