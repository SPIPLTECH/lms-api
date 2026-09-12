const test = require("node:test");
const assert = require("node:assert/strict");

// aiCourseGenerator.service.js only ever talks to the LLM through
// llmService.generate — the same seam the rest of the app treats as "the
// only entry point to reach an LLM" (see llm.service.js's own comment).
// Mocking at that seam (rather than the raw @google/genai SDK) exercises
// exactly the code this bug lives in without depending on retry/backoff
// timing, which is already covered separately in
// src/modules/llm/tests/geminiProvider.test.js.
const llmService = require("../../llm/llm.service");
const { generateCourseFromPrompt } = require("../services/aiCourseGenerator.service");

const originalGenerate = llmService.generate;

test.afterEach(() => {
  llmService.generate = originalGenerate;
});

function classifiedError(code, statusCode, finishReason, message) {
  const err = new Error(message || `${code} test error`);
  err.code = code;
  err.statusCode = statusCode;
  if (finishReason) err.finishReason = finishReason;
  return err;
}

test("4. Empty response from the LLM gateway never reaches JSON.parse and is classified, not reported as invalid JSON", async () => {
  llmService.generate = async () => ({ response: "", finishReason: "STOP" });

  await assert.rejects(
    () => generateCourseFromPrompt({ prompt: "Explain closures", scope: "TOPIC" }),
    (err) => {
      assert.equal(err.code, "AI_GENERATION_TEMPORARY_FAILURE");
      assert.doesNotMatch(err.message, /json/i, "an empty response must not be reported to the client as invalid JSON");
      return true;
    }
  );
});

test("5. Malformed (non-empty) JSON is classified as a temporary failure and the raw response text is never leaked to the client", async () => {
  const rawGarbage = "Sure! Here's your course: { title: 'oops', not valid json ***";
  llmService.generate = async () => ({ response: rawGarbage, finishReason: "STOP" });

  await assert.rejects(
    () => generateCourseFromPrompt({ prompt: "Explain closures", scope: "TOPIC" }),
    (err) => {
      assert.equal(err.code, "AI_GENERATION_TEMPORARY_FAILURE");
      assert.equal(err.statusCode, 502);
      assert.ok(!err.message.includes(rawGarbage.slice(0, 20)), "client-facing message must not contain an excerpt of the raw model output");
      assert.doesNotMatch(err.message, /excerpt/i);
      return true;
    }
  );
});

test("6. Valid JSON response is parsed and returned unchanged (existing behavior preserved)", async () => {
  const payload = { title: "What is a closure?", description: "...", contents: [], quiz: { questions: [] } };
  llmService.generate = async () => ({ response: JSON.stringify(payload), finishReason: "STOP" });

  const result = await generateCourseFromPrompt({ prompt: "Explain closures", scope: "TOPIC" });

  assert.deepEqual(result, payload);
});

test("2b. Gemini 503 retries-exhausted error surfaces as the same client-safe temporary-failure shape used elsewhere", async () => {
  llmService.generate = async () => {
    throw classifiedError("GEMINI_TRANSIENT_ERROR", 503, undefined, "503 UNAVAILABLE");
  };

  await assert.rejects(
    () => generateCourseFromPrompt({ prompt: "Explain closures", scope: "TOPIC" }),
    (err) => {
      assert.equal(err.code, "AI_GENERATION_TEMPORARY_FAILURE");
      assert.equal(err.statusCode, 503);
      return true;
    }
  );
});

test("7 & 8. MODULE phase 2: group1 (RECITATION, retries exhausted) fails, group2 succeeds -> overall generation fails atomically, group2's result is not silently discarded/unawaited, and no unhandled promise rejection occurs", async () => {
  const roster = {
    title: "Test Module",
    description: "A test module.",
    quizzes: [],
    lessons: [
      { title: "Lesson A", description: "First lesson." },
      { title: "Lesson B", description: "Second lesson." },
    ],
  };

  let group2Called = false;

  llmService.generate = async ({ prompt }) => {
    if (prompt.includes("MODULE_ROSTER")) {
      return { response: JSON.stringify(roster), finishReason: "STOP" };
    }
    if (prompt.includes("Lesson A")) {
      // Simulates geminiProvider having already retried internally and
      // given up — aiCourseGenerator must not re-report this as "invalid
      // JSON" just because it eventually has no parseable text.
      throw classifiedError("GEMINI_RECITATION", 502, "RECITATION", "blocked");
    }
    if (prompt.includes("Lesson B")) {
      group2Called = true;
      return {
        response: JSON.stringify({
          lessons: [{ title: "Lesson B", description: "Second lesson.", quizzes: [], topics: [] }],
        }),
        finishReason: "STOP",
      };
    }
    throw new Error(`Unexpected prompt in test mock: ${prompt.slice(0, 80)}`);
  };

  let unhandledRejectionFired = false;
  const onUnhandledRejection = () => {
    unhandledRejectionFired = true;
  };
  process.on("unhandledRejection", onUnhandledRejection);

  try {
    await assert.rejects(
      () => generateCourseFromPrompt({ prompt: "Build a module on X", scope: "MODULE" }),
      (err) => {
        // The frontend must see the real classified reason (content
        // blocked), never a misleading generic "invalid JSON" message.
        assert.equal(err.code, "AI_GENERATION_CONTENT_BLOCKED");
        return true;
      }
    );

    assert.equal(group2Called, true, "group2 must still be awaited to completion even though group1 failed (Promise.allSettled, not Promise.all)");

    // Give any stray unhandled rejection a tick to surface before asserting none did.
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(unhandledRejectionFired, false, "group2's settled result must not be left as an unhandled rejection/dangling promise");
  } finally {
    process.off("unhandledRejection", onUnhandledRejection);
  }
});
