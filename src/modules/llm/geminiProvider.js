const { GoogleGenAI } = require("@google/genai");

const getApiKey = () => process.env.GEMINI_API_KEY;
const getModelName = () => process.env.GEMINI_MODEL || "gemini-3.6-flash";

// Bounded output-token caps per requested course "size" (SMALL/MEDIUM/LARGE
// — see aiCourseGenerator.service.js's courseSize). Prevents an unbounded
// generation from running arbitrarily long, while staying generous enough
// that a normal MODULE/LESSON/TOPIC/CONTENT/QUIZ generation is never
// truncated. MEDIUM was raised from 16384 to 32768 after a reproduced
// MODULE generation hit finishReason: MAX_TOKENS at 16380/16384 tokens used
// (589 of them spent on gemini-3.6-flash's internal "thinking" budget, which
// counts against this same cap) — the truncated JSON then failed
// JSON.parse() in aiCourseGenerator.service.js. Still bounded, not
// unlimited.
const MAX_OUTPUT_TOKENS_BY_SIZE = {
  SMALL: Number(process.env.GEMINI_MAX_OUTPUT_TOKENS_SMALL) || 8192,
  MEDIUM: Number(process.env.GEMINI_MAX_OUTPUT_TOKENS_MEDIUM) || 32768,
  LARGE: Number(process.env.GEMINI_MAX_OUTPUT_TOKENS_LARGE) || 32768,
};

const getMaxOutputTokens = (size) => {
  if (process.env.GEMINI_MAX_OUTPUT_TOKENS) return Number(process.env.GEMINI_MAX_OUTPUT_TOKENS);
  const key = (size || "MEDIUM").toUpperCase();
  return MAX_OUTPUT_TOKENS_BY_SIZE[key] || MAX_OUTPUT_TOKENS_BY_SIZE.MEDIUM;
};

// Only transient failures are retried — a bad API key, a malformed request,
// or a validation error will fail identically on every attempt, so retrying
// those would just add latency without ever succeeding.
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
const MAX_RETRIES = Number(process.env.GEMINI_MAX_RETRIES) || 2;
const RETRY_BASE_DELAY_MS = Number(process.env.GEMINI_RETRY_BASE_DELAY_MS) || 500;

const isRetryableError = (err) => {
  const status = Number(err?.status || err?.statusCode);
  if (RETRYABLE_STATUS_CODES.has(status)) return true;

  const msg = (err?.message || "").toLowerCase();
  return (
    msg.includes("econnreset") ||
    msg.includes("etimedout") ||
    msg.includes("econnrefused") ||
    msg.includes("fetch failed") ||
    msg.includes("socket hang up") ||
    msg.includes("network") ||
    msg.includes("unavailable") ||
    msg.includes("overloaded") ||
    msg.includes("503") ||
    msg.includes("502")
  );
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Executes a structured AI generation request via Google Gemini API (@google/genai).
 * Retries a bounded number of times, with exponential backoff, but only for
 * transient failures (429 / 5xx / network errors) — never for a missing/bad
 * API key or a malformed request, which fail the same way on every attempt.
 */
const generate = async ({ systemPrompt, prompt, context, size } = {}) => {
  const apiKey = getApiKey();
  if (!apiKey || !apiKey.trim()) {
    const err = new Error("AI service is not configured. Missing GEMINI_API_KEY.");
    err.statusCode = 401;
    throw err;
  }

  const ai = new GoogleGenAI({ apiKey: apiKey.trim() });
  const model = getModelName();
  const maxOutputTokens = getMaxOutputTokens(size);

  let fullPrompt = prompt || "";
  if (context && typeof context === "object" && Object.keys(context).length > 0) {
    fullPrompt += `\n\nContext:\n${JSON.stringify(context, null, 2)}`;
  }

  let attempt = 0;
  while (true) {
    try {
      const startTime = Date.now();
      console.log(
        `[Gemini Provider] Sending generation request to model: ${model} (maxOutputTokens: ${maxOutputTokens})${
          attempt > 0 ? ` [retry ${attempt}/${MAX_RETRIES}]` : ""
        }`
      );

      const response = await ai.models.generateContent({
        model,
        contents: fullPrompt,
        config: {
          systemInstruction: systemPrompt,
          responseMimeType: "application/json",
          maxOutputTokens,
        },
      });

      const duration = Date.now() - startTime;
      const usage = response.usageMetadata || {};
      const finishReason = response.candidates?.[0]?.finishReason;
      const responseText = response.text || "";
      // Kept permanently (not stripped after testing): one extra log line,
      // same [Gemini Provider] convention as the rest of this file, and the
      // only place in the app that ever surfaces token counts/finishReason
      // — directly answers "is this response close to truncating" and "how
      // much of maxOutputTokens did this actually use" without needing a
      // one-off diagnostic script each time it's in question.
      console.log(
        `[Gemini Provider] Gemini response received in ${duration} ms | finishReason=${finishReason} | ` +
          `promptTokens=${usage.promptTokenCount ?? "?"} outputTokens=${usage.candidatesTokenCount ?? "?"} ` +
          `thoughtsTokens=${usage.thoughtsTokenCount ?? 0} totalTokens=${usage.totalTokenCount ?? "?"} | ` +
          `responseChars=${responseText.length}`
      );

      return {
        response: responseText,
        usage,
        finishReason,
        model,
      };
    } catch (err) {
      console.error("[Gemini Provider] Gemini API Error:", err.message || err);

      if (isRetryableError(err) && attempt < MAX_RETRIES) {
        const delayMs = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
        attempt += 1;
        console.warn(`[Gemini Provider] Transient error — retrying attempt ${attempt}/${MAX_RETRIES} in ${delayMs}ms...`);
        await sleep(delayMs);
        continue;
      }

      let message = "AI generation failed. Please try again.";
      let statusCode = 502;

      const errMsg = (err.message || "").toLowerCase();
      const errStatus = err.status || err.statusCode;

      if (errStatus === 401 || errStatus === 403 || errMsg.includes("api key") || errMsg.includes("unauthorized")) {
        message = "AI authorization failed. Check server GEMINI_API_KEY.";
        statusCode = 401;
      } else if (errStatus === 429 || errMsg.includes("quota") || errMsg.includes("rate limit") || errMsg.includes("resource_exhausted")) {
        message = "AI usage limit reached. Please try again later.";
        statusCode = 429;
      } else if (errMsg.includes("timeout") || errMsg.includes("deadline")) {
        message = "AI request timed out. Please try again.";
        statusCode = 504;
      }

      const apiErr = new Error(message);
      apiErr.statusCode = statusCode;
      apiErr.originalError = err;
      throw apiErr;
    }
  }
};

module.exports = { generate, getApiKey, getModelName };
