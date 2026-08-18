const test = require("node:test");
const assert = require("node:assert/strict");
const axios = require("axios");

const ApiError = require("../src/utils/ApiError");

// axios exposes plain function properties (not a Proxy like PrismaClient), so
// a direct save/restore swap is enough here - same spirit as the mockMethod
// helper in ownership.middleware.test.js, just without the Proxy workaround.
const mockAxiosPost = (t, impl) => {
  const original = axios.post;
  axios.post = impl;
  t.after(() => {
    axios.post = original;
  });
};

const ollamaSuccess = ({ content = "Pointers store memory addresses.", think } = {}) => ({
  data: {
    model: "qwen3:8b",
    message: { role: "assistant", content },
    done: true,
    total_duration: 500_000_000,
    load_duration: 50_000_000,
    prompt_eval_count: 31,
    eval_count: 65,
    eval_duration: 400_000_000,
    ...(think !== undefined ? { thinking: think } : {}),
  },
});

test("ollamaClient.chat", async (t) => {
  // Re-require fresh each test so config reads (see config test below) can't
  // bleed between them; the module has no internal state otherwise.
  const ollamaClient = require("../src/modules/llm/ollama.client");

  await t.test("normalizes a connection error (Ollama unavailable)", async (t) => {
    mockAxiosPost(t, async () => {
      const error = new Error("connect ECONNREFUSED 127.0.0.1:11434");
      error.code = "ECONNREFUSED";
      throw error;
    });

    await assert.rejects(
      () => ollamaClient.chat({ prompt: "hi", think: false }),
      (error) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.statusCode, 503);
        return true;
      }
    );
  });

  await t.test("normalizes a timeout error", async (t) => {
    mockAxiosPost(t, async () => {
      const error = new Error("timeout of 120000ms exceeded");
      error.code = "ECONNABORTED";
      throw error;
    });

    await assert.rejects(
      () => ollamaClient.chat({ prompt: "hi", think: false }),
      (error) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.statusCode, 504);
        return true;
      }
    );
  });

  await t.test("normalizes a model-not-found error", async (t) => {
    mockAxiosPost(t, async () => {
      const error = new Error("Request failed with status code 404");
      error.response = { status: 404, data: { error: "model 'qwen3:8b' not found" } };
      throw error;
    });

    await assert.rejects(
      () => ollamaClient.chat({ prompt: "hi", think: false }),
      (error) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.statusCode, 404);
        return true;
      }
    );
  });

  await t.test("normalizes a malformed Ollama response (missing message.content)", async (t) => {
    mockAxiosPost(t, async () => ({ data: { model: "qwen3:8b", done: true } }));

    await assert.rejects(
      () => ollamaClient.chat({ prompt: "hi", think: false }),
      (error) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.statusCode, 502);
        return true;
      }
    );
  });

  await t.test("returns the raw Ollama payload on success", async (t) => {
    mockAxiosPost(t, async () => ollamaSuccess());

    const result = await ollamaClient.chat({ prompt: "hi", think: false });

    assert.equal(result.message.content, "Pointers store memory addresses.");
    assert.equal(result.prompt_eval_count, 31);
  });

  await t.test("normalizes a timeout error for a thinking request", async (t) => {
    mockAxiosPost(t, async () => {
      const error = new Error("timeout of 180000ms exceeded");
      error.code = "ECONNABORTED";
      throw error;
    });

    await assert.rejects(
      () => ollamaClient.chat({ prompt: "hi", think: true }),
      (error) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.statusCode, 504);
        assert.doesNotMatch(error.message, /ECONNABORTED|axios|stack/i);
        return true;
      }
    );
  });

  await t.test("uses OLLAMA_TIMEOUT_MS (not the thinking timeout) when think is false", async (t) => {
    const llmConfig = require("../src/modules/llm/llm.config");
    let sentOptions;
    mockAxiosPost(t, async (_url, _payload, options) => {
      sentOptions = options;
      return ollamaSuccess();
    });

    await ollamaClient.chat({ prompt: "hi", think: false });

    assert.equal(sentOptions.timeout, llmConfig.timeoutMs);
    assert.notEqual(sentOptions.timeout, llmConfig.thinkTimeoutMs);
  });

  await t.test("uses OLLAMA_THINK_TIMEOUT_MS when think is true", async (t) => {
    const llmConfig = require("../src/modules/llm/llm.config");
    let sentOptions;
    mockAxiosPost(t, async (_url, _payload, options) => {
      sentOptions = options;
      return ollamaSuccess();
    });

    await ollamaClient.chat({ prompt: "hi", think: true });

    assert.equal(sentOptions.timeout, llmConfig.thinkTimeoutMs);
    assert.notEqual(sentOptions.timeout, llmConfig.timeoutMs);
  });

  await t.test("passes OLLAMA_MAX_OUTPUT_TOKENS as the num_predict generation option when think is false", async (t) => {
    const llmConfig = require("../src/modules/llm/llm.config");
    let sentPayload;
    mockAxiosPost(t, async (_url, payload) => {
      sentPayload = payload;
      return ollamaSuccess();
    });

    await ollamaClient.chat({ prompt: "hi", think: false });

    assert.equal(sentPayload.options.num_predict, llmConfig.maxOutputTokens);
  });

  await t.test("omits num_predict generation option when think is true", async (t) => {
    let sentPayload;
    mockAxiosPost(t, async (_url, payload) => {
      sentPayload = payload;
      return ollamaSuccess();
    });

    await ollamaClient.chat({ prompt: "hi", think: true });

    assert.equal(sentPayload.options, undefined);
  });

  await t.test("normalizes a response with empty content as a malformed response error (502)", async (t) => {
    mockAxiosPost(t, async () => ({
      data: {
        model: "qwen3:8b",
        message: { role: "assistant", content: "", thinking: "Lots of reasoning..." },
        done: true,
      },
    }));

    await assert.rejects(
      () => ollamaClient.chat({ prompt: "hi", think: true }),
      (error) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.statusCode, 502);
        return true;
      }
    );
  });
});

test("llmGateway.generate", async (t) => {
  const llmGateway = require("../src/modules/llm/llm.service");

  await t.test("successful generation returns the normalized response shape", async (t) => {
    mockAxiosPost(t, async () => ollamaSuccess());

    const result = await llmGateway.generate({
      prompt: "Explain C++ pointers in exactly 3 short sentences.",
      think: false,
    });

    assert.equal(result.response, "Pointers store memory addresses.");
    assert.equal(result.model, "qwen3:8b");
    assert.equal(result.thinkingEnabled, false);
    assert.deepEqual(result.usage, { promptTokens: 31, outputTokens: 65, totalTokens: 96 });
    assert.deepEqual(result.latency, { totalMs: 500, loadMs: 50, evalMs: 400 });
  });

  await t.test("hides internal reasoning from the response payload when think is true", async (t) => {
    mockAxiosPost(t, async () =>
      ollamaSuccess({ content: "Pointers store memory addresses.", think: "Internal thinking..." })
    );

    const result = await llmGateway.generate({
      prompt: "Explain C++ pointers",
      think: true,
    });

    assert.equal(result.response, "Pointers store memory addresses.");
    assert.equal(result.thinkingEnabled, true);
    assert.equal(result.thinking, undefined);
    assert.equal(result.reasoning, undefined);
  });

  await t.test("think: false is forwarded to the Ollama client unchanged", async (t) => {
    let sentPayload;
    mockAxiosPost(t, async (_url, payload) => {
      sentPayload = payload;
      return ollamaSuccess();
    });

    await llmGateway.generate({ prompt: "Simple hint please", think: false });

    assert.equal(sentPayload.think, false);
  });

  await t.test("think: true is forwarded to the Ollama client unchanged", async (t) => {
    let sentPayload;
    mockAxiosPost(t, async (_url, payload) => {
      sentPayload = payload;
      return ollamaSuccess();
    });

    const result = await llmGateway.generate({
      prompt: "Analyze this student's misconception about pointers.",
      think: true,
    });

    assert.equal(sentPayload.think, true);
    assert.equal(result.thinkingEnabled, true);
  });

  await t.test("think defaults to false when omitted by the caller", async (t) => {
    let sentPayload;
    mockAxiosPost(t, async (_url, payload) => {
      sentPayload = payload;
      return ollamaSuccess();
    });

    const result = await llmGateway.generate({ prompt: "no think field given" });

    assert.equal(sentPayload.think, false);
    assert.equal(result.thinkingEnabled, false);
  });

  await t.test("usage/latency fields are null (not invented) when Ollama omits them", async (t) => {
    mockAxiosPost(t, async () => ({
      data: { model: "qwen3:8b", message: { role: "assistant", content: "ok" }, done: true },
    }));

    const result = await llmGateway.generate({ prompt: "hi", think: false });

    assert.deepEqual(result.usage, { promptTokens: null, outputTokens: null, totalTokens: null });
    assert.deepEqual(result.latency, { totalMs: null, loadMs: null, evalMs: null });
  });

  await t.test("propagates the normalized ApiError when Ollama is unavailable", async (t) => {
    mockAxiosPost(t, async () => {
      const error = new Error("connect ECONNREFUSED");
      error.code = "ECONNREFUSED";
      throw error;
    });

    await assert.rejects(
      () => llmGateway.generate({ prompt: "hi", think: false }),
      (error) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.statusCode, 503);
        return true;
      }
    );
  });
});

test("llm.config loads settings from environment variables", async (t) => {
  const configPath = require.resolve("../src/modules/llm/llm.config");
  const originalEnv = { ...process.env };

  t.after(() => {
    delete require.cache[configPath];
    process.env = originalEnv;
  });

  await t.test("falls back to defaults when unset", () => {
    delete require.cache[configPath];
    delete process.env.OLLAMA_BASE_URL;
    delete process.env.OLLAMA_MODEL;
    delete process.env.OLLAMA_TIMEOUT_MS;
    delete process.env.OLLAMA_THINK_TIMEOUT_MS;
    delete process.env.OLLAMA_MAX_OUTPUT_TOKENS;

    const config = require("../src/modules/llm/llm.config");

    assert.equal(config.baseUrl, "http://localhost:11434");
    assert.equal(config.model, "qwen3.5:4b");
    assert.equal(config.timeoutMs, 60000);
    assert.equal(config.thinkTimeoutMs, 180000);
    assert.equal(config.maxOutputTokens, 1024);
  });

  await t.test("reads explicit environment variables when set", () => {
    delete require.cache[configPath];
    process.env.OLLAMA_BASE_URL = "http://ollama-host:11434";
    process.env.OLLAMA_MODEL = "qwen3:14b";
    process.env.OLLAMA_TIMEOUT_MS = "45000";
    process.env.OLLAMA_THINK_TIMEOUT_MS = "200000";
    process.env.OLLAMA_MAX_OUTPUT_TOKENS = "512";

    const config = require("../src/modules/llm/llm.config");

    assert.equal(config.baseUrl, "http://ollama-host:11434");
    assert.equal(config.model, "qwen3:14b");
    assert.equal(config.timeoutMs, 45000);
    assert.equal(config.thinkTimeoutMs, 200000);
    assert.equal(config.maxOutputTokens, 512);
  });
});

test("llm.validation generateSchema", async (t) => {
  const { generateSchema } = require("../src/modules/llm/llm.validation");

  await t.test("accepts a minimal valid request and defaults think to false", () => {
    const { error, value } = generateSchema.validate({ prompt: "Explain pointers" });

    assert.equal(error, undefined);
    assert.equal(value.think, false);
  });

  await t.test("rejects a missing prompt", () => {
    const { error } = generateSchema.validate({ think: true });

    assert.ok(error);
    assert.match(error.details[0].message, /prompt/i);
  });

  await t.test("rejects an empty prompt", () => {
    const { error } = generateSchema.validate({ prompt: "" });

    assert.ok(error);
  });

  await t.test("rejects a prompt over the length limit", () => {
    const { error } = generateSchema.validate({ prompt: "a".repeat(4001) });

    assert.ok(error);
  });

  await t.test("rejects a non-boolean think value", () => {
    const { error } = generateSchema.validate({ prompt: "hi", think: "maybe" });

    assert.ok(error);
  });

  await t.test("accepts systemPrompt and a structured context object", () => {
    const { error, value } = generateSchema.validate({
      systemPrompt: "You are a tutor.",
      prompt: "Explain pointers",
      context: { concept: "Pointers", difficulty: "beginner" },
      think: true,
    });

    assert.equal(error, undefined);
    assert.equal(value.context.concept, "Pointers");
    assert.equal(value.think, true);
  });

  await t.test("rejects a context object with too many keys", () => {
    const context = {};
    for (let i = 0; i < 21; i += 1) {
      context[`key${i}`] = i;
    }

    const { error } = generateSchema.validate({ prompt: "hi", context });

    assert.ok(error);
  });
});
