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

// finishReason values where the SDK's `response.text` getter comes back
// empty because content was withheld (not because generation legitimately
// produced nothing) — see @google/genai's FinishReason enum. RECITATION is
// the one observed in production (Gemini judged the output too close to
// verbatim source/context text); the rest are included because they cause
// the exact same "empty text, non-error response" shape.
const BLOCKED_FINISH_REASONS = new Set(["RECITATION", "SAFETY", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII"]);

// An empty/blocked response isn't a thrown SDK error, so it can't be
// detected from `err.status`/`err.message` alone — the caller marks it with
// `isEmptyResponse` before re-throwing it into this same retry path (see
// `generate()` below). Retrying it reuses the SAME bounded MAX_RETRIES/
// backoff budget as a transient network error, rather than adding a second,
// separate retry allowance.
const isRetryableError = (err) => {
  if (err?.isEmptyResponse) return true;

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
  // Set only after an empty/blocked (e.g. RECITATION) response, so the next
  // retry attempt — and only that attempt — asks the model to paraphrase
  // instead of repeating the exact same prompt verbatim. A plain retry of an
  // identical prompt has real (if not huge) value here since generation
  // isn't fully deterministic, but nudging the instructions gives the retry
  // a genuinely different chance rather than just re-rolling the dice.
  let lastFinishReason = null;

  while (true) {
    try {
      const startTime = Date.now();
      console.log(
        `[Gemini Provider] Sending generation request to model: ${model} (maxOutputTokens: ${maxOutputTokens})${
          attempt > 0 ? ` [retry ${attempt}/${MAX_RETRIES}]` : ""
        }`
      );

      const attemptSystemPrompt = BLOCKED_FINISH_REASONS.has(lastFinishReason)
        ? `${systemPrompt}\n\nIMPORTANT: Your previous response was blocked (finishReason=${lastFinishReason}) for potentially reproducing source/context text verbatim. Paraphrase everything in your own original wording this time — do not copy long passages from the prompt, the provided context, or any reference material.`
        : systemPrompt;

      const response = await ai.models.generateContent({
        model,
        contents: fullPrompt,
        config: {
          systemInstruction: attemptSystemPrompt,
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

      // The SDK does NOT throw for a blocked/empty candidate — `response.text`
      // just comes back "". Detect that explicitly here, before any caller
      // can hand an empty string to JSON.parse, and route it through the
      // SAME catch/retry/classification path below as a real error instead
      // of returning a fake "success".
      if (!responseText || !responseText.trim()) {
        const emptyErr = new Error(`Gemini returned an empty response (finishReason=${finishReason || "UNKNOWN"}).`);
        emptyErr.isEmptyResponse = true;
        emptyErr.finishReason = finishReason;
        throw emptyErr;
      }

      return {
        response: responseText,
        usage,
        finishReason,
        model,
      };
    } catch (err) {
      const isBlocked = err.isEmptyResponse && BLOCKED_FINISH_REASONS.has(err.finishReason);
      console.error(
        "[Gemini Provider] Gemini API Error:",
        err.isEmptyResponse ? err.message : err.message || err
      );

      if (isRetryableError(err) && attempt < MAX_RETRIES) {
        const delayMs = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
        attempt += 1;
        if (err.isEmptyResponse) lastFinishReason = err.finishReason;
        console.warn(
          `[Gemini Provider] ${
            err.isEmptyResponse ? `Empty/blocked response (finishReason=${err.finishReason || "UNKNOWN"})` : "Transient error"
          } — retrying attempt ${attempt}/${MAX_RETRIES} in ${delayMs}ms...`
        );
        await sleep(delayMs);
        continue;
      }

      const errMsg = (err.message || "").toLowerCase();
      const errStatus = err.status || err.statusCode;

      let message = "AI generation failed. Please try again.";
      let statusCode = 502;
      let code = "GEMINI_NON_RETRYABLE_ERROR";

      if (isBlocked) {
        message = `Gemini blocked the response (finishReason=${err.finishReason}) after ${MAX_RETRIES} retr${MAX_RETRIES === 1 ? "y" : "ies"}.`;
        statusCode = 502;
        code = "GEMINI_RECITATION";
      } else if (err.isEmptyResponse) {
        message = `Gemini returned an empty response (finishReason=${err.finishReason || "UNKNOWN"}) after ${MAX_RETRIES} retr${MAX_RETRIES === 1 ? "y" : "ies"}.`;
        statusCode = 502;
        code = "GEMINI_EMPTY_RESPONSE";
      } else if (errStatus === 401 || errStatus === 403 || errMsg.includes("api key") || errMsg.includes("unauthorized")) {
        message = "AI authorization failed. Check server GEMINI_API_KEY.";
        statusCode = 502;
        code = "GEMINI_AUTH_ERROR";
      } else if (errStatus === 429 || errMsg.includes("quota") || errMsg.includes("rate limit") || errMsg.includes("resource_exhausted")) {
        message = "AI usage limit reached. Please try again later.";
        statusCode = 429;
        code = "GEMINI_TRANSIENT_ERROR";
      } else if (errStatus === 503 || errMsg.includes("unavailable") || errMsg.includes("high demand")) {
        message = "The AI provider is currently experiencing high demand. Please try again in a few minutes.";
        statusCode = 503;
        code = "GEMINI_TRANSIENT_ERROR";
      } else if (errMsg.includes("timeout") || errMsg.includes("deadline")) {
        message = "AI request timed out. Please try again.";
        statusCode = 504;
        code = "GEMINI_TRANSIENT_ERROR";
      } else if (RETRYABLE_STATUS_CODES.has(Number(errStatus))) {
        // Retryable status that still failed after exhausting MAX_RETRIES.
        message = "AI generation failed after multiple attempts. Please try again.";
        statusCode = 502;
        code = "GEMINI_TRANSIENT_ERROR";
      }

      const apiErr = new Error(message);
      apiErr.statusCode = statusCode;
      apiErr.code = code;
      apiErr.finishReason = err.finishReason;
      apiErr.originalError = err;
      throw apiErr;
    }
  }
};

module.exports = { generate, getApiKey, getModelName };