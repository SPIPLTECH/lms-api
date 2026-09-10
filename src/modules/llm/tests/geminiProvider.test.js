// Env vars are read once at module-load time inside geminiProvider.js, so
// they must be set before it is first required below.
process.env.GEMINI_API_KEY = "test-key";
process.env.GEMINI_RETRY_BASE_DELAY_MS = "1"; // keep retry/backoff tests fast
process.env.GEMINI_MAX_RETRIES = "2";

const test = require("node:test");
const assert = require("node:assert/strict");

// geminiProvider.js does `require("@google/genai")` and destructures
// `GoogleGenAI` at module-load time, so the fake SDK must be installed in
// require.cache BEFORE geminiProvider.js is first required — swapping it
// afterward would have no effect on the already-bound reference. Each test
// then reconfigures `currentImpl` rather than re-requiring anything.
const geminiSdkPath = require.resolve("@google/genai");
let currentImpl = null;
let calls = [];

class FakeGoogleGenAI {
  constructor() {
    this.models = {
      generateContent: async (params) => {
        calls.push(params);
        return currentImpl(params);
      },
    };
  }
}

require.cache[geminiSdkPath] = {
  id: geminiSdkPath,
  filename: geminiSdkPath,
  loaded: true,
  exports: { GoogleGenAI: FakeGoogleGenAI },
};

const geminiProvider = require("../geminiProvider.js");

function make503Error() {
  const err = new Error("503 UNAVAILABLE: The model is currently experiencing high demand.");
  err.status = 503;
  return err;
}

function makeResponse({ text, finishReason, usageMetadata = {} }) {
  return { text, candidates: [{ finishReason }], usageMetadata };
}

test.beforeEach(() => {
  calls = [];
  currentImpl = null;
});

test("1. Gemini 503 -> retry -> success", async () => {
  let attempt = 0;
  currentImpl = async () => {
    attempt += 1;
    if (attempt === 1) throw make503Error();
    return makeResponse({ text: '{"ok":true}', finishReason: "STOP" });
  };

  const result = await geminiProvider.generate({ systemPrompt: "sys", prompt: "user", size: "SMALL" });

  assert.equal(result.response, '{"ok":true}');
  assert.equal(result.finishReason, "STOP");
  assert.equal(calls.length, 2, "should have retried exactly once before succeeding");
});

test("2. Gemini 503 -> retries exhausted -> classified GEMINI_TRANSIENT_ERROR", async () => {
  currentImpl = async () => {
    throw make503Error();
  };

  await assert.rejects(
    () => geminiProvider.generate({ systemPrompt: "sys", prompt: "user", size: "SMALL" }),
    (err) => {
      assert.equal(err.code, "GEMINI_TRANSIENT_ERROR");
      assert.equal(err.statusCode, 503);
      return true;
    }
  );
  // initial attempt + MAX_RETRIES(2) retries = 3 calls, then it must stop —
  // this is the "do not silently loop indefinitely" requirement.
  assert.equal(calls.length, 3);
});

test("3. Gemini RECITATION + empty response -> retried once with an anti-recitation nudge, then classified GEMINI_RECITATION", async () => {
  currentImpl = async () => makeResponse({ text: "", finishReason: "RECITATION" });

  await assert.rejects(
    () => geminiProvider.generate({ systemPrompt: "base instructions", prompt: "user", size: "SMALL" }),
    (err) => {
      assert.equal(err.code, "GEMINI_RECITATION");
      assert.equal(err.finishReason, "RECITATION");
      // Client-facing classification must not silently masquerade as invalid JSON.
      assert.doesNotMatch(err.message.toLowerCase(), /json/);
      return true;
    }
  );

  assert.equal(calls.length, 3, "empty/blocked responses are retried within the SAME bounded budget as transient errors");
  assert.doesNotMatch(calls[0].config.systemInstruction, /blocked/i, "first attempt uses the plain system prompt");
  assert.match(calls[1].config.systemInstruction, /blocked.*RECITATION/i, "retry attempts are nudged to paraphrase instead of repeating the identical prompt");
  assert.match(calls[2].config.systemInstruction, /paraphrase/i);
});

test("4. Gemini empty response with no blocking finishReason -> classified GEMINI_EMPTY_RESPONSE (never reaches JSON.parse)", async () => {
  currentImpl = async () => makeResponse({ text: "", finishReason: "STOP" });

  await assert.rejects(
    () => geminiProvider.generate({ systemPrompt: "sys", prompt: "user", size: "SMALL" }),
    (err) => {
      assert.equal(err.code, "GEMINI_EMPTY_RESPONSE");
      assert.notEqual(err.code, "GEMINI_RECITATION", "an unblocked empty response must not be misreported as a recitation block");
      return true;
    }
  );
});

test("5. Non-retryable auth error (401) -> classified GEMINI_AUTH_ERROR without retrying", async () => {
  currentImpl = async () => {
    const err = new Error("401 Unauthorized: invalid API key");
    err.status = 401;
    throw err;
  };

  await assert.rejects(
    () => geminiProvider.generate({ systemPrompt: "sys", prompt: "user", size: "SMALL" }),
    (err) => {
      assert.equal(err.code, "GEMINI_AUTH_ERROR");
      return true;
    }
  );
  assert.equal(calls.length, 1, "a bad API key fails identically on every attempt, so it must not be retried");
});

test("6. Valid JSON response passes through unchanged (existing success path preserved)", async () => {
  currentImpl = async () => makeResponse({ text: '{"title":"Hello"}', finishReason: "STOP", usageMetadata: { promptTokenCount: 10 } });

  const result = await geminiProvider.generate({ systemPrompt: "sys", prompt: "user", size: "SMALL" });

  assert.equal(result.response, '{"title":"Hello"}');
  assert.equal(result.finishReason, "STOP");
  assert.equal(calls.length, 1);
});
