// Gemini streaming + JSON-mode parameterisation, and proof that the shared
// gateway's pre-existing Ollama path is untouched.
//
// Env is read at module-load time inside geminiProvider.js, so it is set here
// before anything is required.
process.env.GEMINI_API_KEY = "test-key";
process.env.GEMINI_RETRY_BASE_DELAY_MS = "1";
process.env.GEMINI_MAX_RETRIES = "2";

const test = require("node:test");
const assert = require("node:assert/strict");

// Same technique as src/modules/llm/tests/geminiProvider.test.js: the fake SDK
// must be in require.cache BEFORE geminiProvider.js first requires it, since
// it destructures GoogleGenAI at module-load time.
const geminiSdkPath = require.resolve("@google/genai");

let streamImpl = null;
let generateImpl = null;
let streamCalls = [];
let generateCalls = [];

class FakeGoogleGenAI {
  constructor() {
    this.models = {
      generateContent: async (params) => {
        generateCalls.push(params);
        return generateImpl(params);
      },
      generateContentStream: async (params) => {
        streamCalls.push(params);
        return streamImpl(params);
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

// Fake the Ollama client too, so the "Ollama path still works" assertion does
// not need a live Ollama server.
const ollamaPath = require.resolve("../src/modules/llm/ollama.client");
let ollamaChatStreamCalls = [];
require.cache[ollamaPath] = {
  id: ollamaPath,
  filename: ollamaPath,
  loaded: true,
  exports: {
    chat: async () => ({ message: { content: "ollama-non-stream" }, model: "fake-ollama" }),
    chatStream: async (params) => {
      ollamaChatStreamCalls.push(params);
      params.onToken("ollama-");
      params.onToken("token");
      return { model: "fake-ollama", prompt_eval_count: 1, eval_count: 2, total_duration: 1e6 };
    },
  },
};

const geminiProvider = require("../src/modules/llm/geminiProvider");
const llmService = require("../src/modules/llm/llm.service");

// Builds an async-iterable of fake stream chunks.
const chunksOf = (pieces, finishReason = "STOP") => ({
  async *[Symbol.asyncIterator]() {
    for (let i = 0; i < pieces.length; i += 1) {
      yield {
        text: pieces[i],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: pieces.length, totalTokenCount: 10 + pieces.length },
        candidates: [{ finishReason: i === pieces.length - 1 ? finishReason : undefined }],
      };
    }
  },
});

test.beforeEach(() => {
  streamCalls = [];
  generateCalls = [];
  ollamaChatStreamCalls = [];
  streamImpl = null;
  generateImpl = null;
});

/* ------------------------------------------------------------------ */

test("streams tokens in order and resolves with the concatenated text", async () => {
  streamImpl = () => chunksOf(["Poin", "ters ", "are"]);

  const received = [];
  const res = await geminiProvider.generateStream({
    systemPrompt: "sys",
    prompt: "explain pointers",
    onToken: (t) => received.push(t),
  });

  assert.deepEqual(received, ["Poin", "ters ", "are"]);
  assert.equal(res.response, "Pointers are");
  assert.equal(res.finishReason, "STOP");
  assert.equal(res.usage.promptTokenCount, 10);
});

test("streaming defaults to text/plain, not the JSON mode generate() uses", async () => {
  streamImpl = () => chunksOf(["hi"]);
  await geminiProvider.generateStream({ systemPrompt: "s", prompt: "p", onToken: () => {} });
  assert.equal(streamCalls[0].config.responseMimeType, "text/plain");
});

test("generate() still defaults to application/json — existing callers unchanged", async () => {
  generateImpl = () => ({
    text: '{"ok":true}',
    usageMetadata: {},
    candidates: [{ finishReason: "STOP" }],
  });

  const res = await geminiProvider.generate({ systemPrompt: "s", prompt: "p", size: "SMALL" });

  assert.equal(generateCalls[0].config.responseMimeType, "application/json");
  assert.equal(res.response, '{"ok":true}');
});

test("generate() honours an explicit responseMimeType override", async () => {
  generateImpl = () => ({ text: "plain words", usageMetadata: {}, candidates: [{ finishReason: "STOP" }] });
  await geminiProvider.generate({ systemPrompt: "s", prompt: "p", responseMimeType: "text/plain" });
  assert.equal(generateCalls[0].config.responseMimeType, "text/plain");
});

test("retries a transient failure that happens BEFORE the first token", async () => {
  let attempt = 0;
  streamImpl = () => {
    attempt += 1;
    if (attempt === 1) {
      const err = new Error("fetch failed");
      throw err;
    }
    return chunksOf(["recovered"]);
  };

  const received = [];
  const res = await geminiProvider.generateStream({ prompt: "p", onToken: (t) => received.push(t) });

  assert.equal(attempt, 2, "should have retried exactly once");
  assert.equal(res.response, "recovered");
  assert.deepEqual(received, ["recovered"], "no duplicated text from the failed attempt");
});

test("does NOT retry once tokens have already been emitted", async () => {
  let attempt = 0;
  streamImpl = () => {
    attempt += 1;
    return {
      async *[Symbol.asyncIterator]() {
        yield { text: "partial answer", candidates: [{}] };
        throw new Error("fetch failed"); // transient, but too late to retry
      },
    };
  };

  const received = [];
  await assert.rejects(
    () => geminiProvider.generateStream({ prompt: "p", onToken: (t) => received.push(t) }),
    (err) => {
      assert.equal(err.code, "GEMINI_STREAM_INTERRUPTED");
      assert.equal(err.partialResponse, "partial answer");
      return true;
    }
  );

  assert.equal(attempt, 1, "must not re-run the model after the user has seen output");
  assert.deepEqual(received, ["partial answer"], "no duplicate tokens");
});

test("an empty stream is classified, never returned as a fake success", async () => {
  streamImpl = () => chunksOf([], "RECITATION");
  await assert.rejects(
    () => geminiProvider.generateStream({ prompt: "p", onToken: () => {} }),
    (err) => {
      assert.ok(["GEMINI_RECITATION", "GEMINI_EMPTY_RESPONSE"].includes(err.code), err.code);
      return true;
    }
  );
});

test("an already-aborted signal stops the call before reaching the model", async () => {
  streamImpl = () => chunksOf(["should not appear"]);
  const ac = new AbortController();
  ac.abort();

  await assert.rejects(
    () => geminiProvider.generateStream({ prompt: "p", onToken: () => {}, signal: ac.signal }),
    (err) => {
      assert.equal(err.isAbort, true);
      return true;
    }
  );
  assert.equal(streamCalls.length, 0, "model must not be invoked at all");
});

test("aborting mid-stream stops forwarding further tokens", async () => {
  const ac = new AbortController();
  streamImpl = () => ({
    async *[Symbol.asyncIterator]() {
      yield { text: "first", candidates: [{}] };
      ac.abort(); // client disconnects here
      yield { text: "second", candidates: [{}] };
      yield { text: "third", candidates: [{}] };
    },
  });

  const received = [];
  await assert.rejects(
    () => geminiProvider.generateStream({ prompt: "p", onToken: (t) => received.push(t), signal: ac.signal }),
    (err) => err.isAbort === true
  );
  assert.deepEqual(received, ["first"], "nothing after the abort should be forwarded");
});

test("a non-retryable auth failure is classified without leaking the key", async () => {
  streamImpl = () => {
    const err = new Error("401 Unauthorized: invalid API key");
    err.status = 401;
    throw err;
  };

  await assert.rejects(
    () => geminiProvider.generateStream({ prompt: "p", onToken: () => {} }),
    (err) => {
      assert.equal(err.code, "GEMINI_AUTH_ERROR");
      assert.ok(!err.message.includes("test-key"), "must never echo the API key");
      return true;
    }
  );
  assert.equal(streamCalls.length, 1, "auth errors are not retried");
});

/* ---------------- gateway routing ---------------- */

test("gateway routes to Gemini only when provider is explicitly 'gemini'", async () => {
  streamImpl = () => chunksOf(["gem"]);

  const res = await llmService.generateStream({
    provider: "gemini",
    systemPrompt: "s",
    prompt: "p",
    onToken: () => {},
  });

  assert.equal(res.response, "gem");
  assert.equal(streamCalls.length, 1);
  assert.equal(ollamaChatStreamCalls.length, 0, "Ollama must not be touched");
});

test("NON-REGRESSION: gateway still defaults to Ollama when no provider is given", async () => {
  // This is the call shape adaptive-learning uses. GEMINI_API_KEY is set in
  // this process, so this also proves the key's mere presence does not
  // silently reroute the existing streaming feature to Gemini.
  const received = [];
  const res = await llmService.generateStream({
    systemPrompt: "s",
    prompt: "p",
    onToken: (t) => received.push(t),
  });

  assert.equal(ollamaChatStreamCalls.length, 1, "Ollama must still serve the default path");
  assert.equal(streamCalls.length, 0, "Gemini must not be used without an explicit opt-in");
  assert.equal(res.response, "ollama-token");
  assert.deepEqual(received, ["ollama-", "token"]);
});

test("gateway normalises Gemini usage into the shared shape", async () => {
  streamImpl = () => chunksOf(["a", "b"]);
  const res = await llmService.generateStream({ provider: "gemini", prompt: "p", onToken: () => {} });

  assert.equal(res.usage.promptTokens, 10);
  assert.equal(res.usage.outputTokens, 2);
  assert.equal(res.thinkingEnabled, false);
});

/* ---------------- model fallback tests ---------------- */

test("generateStream() falls back to secondary model when primary exhausts retries before first token", async () => {
  const origFallbacks = process.env.GEMINI_FALLBACK_MODELS;
  process.env.GEMINI_FALLBACK_MODELS = "gemini-3.5-flash";

  try {
    streamImpl = (params) => {
      if (params.model === "gemini-3.6-flash") {
        const err = new Error("503 UNAVAILABLE");
        err.status = 503;
        throw err;
      }
      return chunksOf(["fallback-stream"]);
    };

    const received = [];
    const res = await geminiProvider.generateStream({
      prompt: "test",
      onToken: (t) => received.push(t),
    });

    assert.equal(res.response, "fallback-stream");
    assert.equal(res.model, "gemini-3.5-flash");
    assert.deepEqual(received, ["fallback-stream"]);
    assert.equal(streamCalls.length, 4, "3 attempts on primary + 1 attempt on fallback model");
    assert.equal(streamCalls[0].model, "gemini-3.6-flash");
    assert.equal(streamCalls[3].model, "gemini-3.5-flash");
  } finally {
    if (origFallbacks !== undefined) process.env.GEMINI_FALLBACK_MODELS = origFallbacks;
    else delete process.env.GEMINI_FALLBACK_MODELS;
  }
});

test("generateStream() does NOT fall back once tokens have been emitted", async () => {
  const origFallbacks = process.env.GEMINI_FALLBACK_MODELS;
  process.env.GEMINI_FALLBACK_MODELS = "gemini-3.5-flash";

  try {
    streamImpl = (params) => {
      if (params.model === "gemini-3.6-flash") {
        return {
          async *[Symbol.asyncIterator]() {
            yield { text: "token1 ", candidates: [{}] };
            const err = new Error("503 UNAVAILABLE");
            err.status = 503;
            throw err;
          },
        };
      }
      return chunksOf(["should-not-reach-fallback"]);
    };

    const received = [];
    await assert.rejects(
      () => geminiProvider.generateStream({ prompt: "test", onToken: (t) => received.push(t) }),
      (err) => {
        assert.equal(err.code, "GEMINI_STREAM_INTERRUPTED");
        assert.equal(err.partialResponse, "token1 ");
        return true;
      }
    );

    assert.deepEqual(received, ["token1 "]);
    assert.equal(streamCalls.length, 1, "must not attempt secondary model once tokens were emitted");
  } finally {
    if (origFallbacks !== undefined) process.env.GEMINI_FALLBACK_MODELS = origFallbacks;
    else delete process.env.GEMINI_FALLBACK_MODELS;
  }
});

test("generateStream() does NOT fall back on non-retryable 401 auth error", async () => {
  const origFallbacks = process.env.GEMINI_FALLBACK_MODELS;
  process.env.GEMINI_FALLBACK_MODELS = "gemini-3.5-flash";

  try {
    streamImpl = () => {
      const err = new Error("401 Unauthorized: invalid API key");
      err.status = 401;
      throw err;
    };

    await assert.rejects(
      () => geminiProvider.generateStream({ prompt: "test", onToken: () => {} }),
      (err) => {
        assert.equal(err.code, "GEMINI_AUTH_ERROR");
        return true;
      }
    );

    assert.equal(streamCalls.length, 1, "must fail immediately on auth error without attempting fallback model");
  } finally {
    if (origFallbacks !== undefined) process.env.GEMINI_FALLBACK_MODELS = origFallbacks;
    else delete process.env.GEMINI_FALLBACK_MODELS;
  }
});

