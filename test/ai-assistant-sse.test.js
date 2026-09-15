// SSE wire format, error containment, abort handling, and the validation
// layer's rejection of assessment ids. The controller is exercised directly
// against a fake res, so no server or network is needed.

const test = require("node:test");
const assert = require("node:assert/strict");

const servicePath = require.resolve("../src/modules/ai-assistant/aiAssistant.service");

let streamTurnImpl = null;
let lastStreamArgs = null;

require.cache[servicePath] = {
  id: servicePath,
  filename: servicePath,
  loaded: true,
  exports: {
    streamTurn: async (args) => {
      lastStreamArgs = args;
      return streamTurnImpl(args);
    },
    createConversation: async () => ({ id: "c1" }),
    listConversations: async () => [],
    getMessages: async () => [],
    updateConversation: async () => ({ id: "c1" }),
    deleteConversation: async () => ({ id: "c1" }),
    getOwnedConversation: async () => ({ id: "c1" }),
    prepareTurn: async () => ({}),
  },
};

const controller = require("../src/modules/ai-assistant/aiAssistant.controller");
const {
  conversationMessageSchema,
  guestMessageSchema,
  updateConversationSchema,
} = require("../src/modules/ai-assistant/aiAssistant.validation");

/** Minimal Express-ish response that records the SSE frames written to it. */
const makeRes = () => {
  const handlers = {};
  return {
    written: [],
    headers: null,
    statusCode: null,
    writableEnded: false,
    writeHead(code, headers) { this.statusCode = code; this.headers = headers; },
    flushHeaders() {},
    write(chunk) { this.written.push(chunk); return true; },
    end() { this.writableEnded = true; },
    on(evt, fn) { handlers[evt] = fn; },
    emit(evt) { if (handlers[evt]) handlers[evt](); },
    frames() {
      return this.written
        .join("")
        .split("\n\n")
        .filter(Boolean)
        .map((f) => JSON.parse(f.replace(/^data: /, "")));
    },
  };
};

const makeReq = (body = {}, params = {}, user = null) => ({ body, params, user, query: {} });

test.beforeEach(() => {
  streamTurnImpl = null;
  lastStreamArgs = null;
});

/* ======================= SSE wire format ======================= */

test("sets the SSE headers, including no-buffering", async () => {
  streamTurnImpl = async () => ({ requestId: "r1", conversationId: null, scope: "GUEST", model: "m" });
  const res = makeRes();
  await controller.streamGuestMessage(makeReq({ message: "hi", courseId: "c" }), res);

  assert.equal(res.statusCode, 200);
  assert.match(res.headers["Content-Type"], /text\/event-stream/);
  assert.equal(res.headers["Cache-Control"], "no-cache, no-transform");
  assert.equal(res.headers["X-Accel-Buffering"], "no");
});

test("emits chunk frames then a done frame, and closes the stream", async () => {
  streamTurnImpl = async ({ onToken }) => {
    onToken("Hello ");
    onToken("world");
    return { requestId: "r1", conversationId: "conv-1", scope: "ENROLLED", model: "gemini" };
  };

  const res = makeRes();
  await controller.streamConversationMessage(
    makeReq({ message: "hi" }, { conversationId: "conv-1" }, { id: "u1", role: "STUDENT" }),
    res
  );

  const frames = res.frames();
  assert.deepEqual(frames.map((f) => f.type), ["chunk", "chunk", "done"]);
  assert.equal(frames[0].content, "Hello ");
  assert.equal(frames[1].content, "world");
  assert.equal(frames[2].result.scope, "ENROLLED");
  assert.equal(res.writableEnded, true);
});

test("emits an error frame with a requestId and still ends the stream", async () => {
  streamTurnImpl = async () => {
    const err = new Error("AI usage limit reached. Please try again later.");
    err.statusCode = 429;
    err.code = "GEMINI_TRANSIENT_ERROR";
    err.requestId = "req-42";
    throw err;
  };

  const res = makeRes();
  await controller.streamGuestMessage(makeReq({ message: "hi", courseId: "c" }), res);

  const frames = res.frames();
  assert.equal(frames.at(-1).type, "error");
  assert.equal(frames.at(-1).requestId, "req-42");
  assert.equal(frames.at(-1).code, "GEMINI_TRANSIENT_ERROR");
  assert.equal(res.writableEnded, true);
});

test("SECURITY: an unexpected internal error is never surfaced verbatim", async () => {
  streamTurnImpl = async () => {
    // Shaped like a real Prisma failure, complete with internals.
    const err = new Error(
      'Invalid `prisma.aiMessage.create()` invocation in C:\\Orange Tree LMS\\backend\\lms-api\\src\\x.js:42 ' +
      'Foreign key constraint failed on the field: `AiMessage_conversationId_fkey`'
    );
    throw err;
  };

  const res = makeRes();
  await controller.streamConversationMessage(
    makeReq({ message: "hi" }, { conversationId: "c1" }, { id: "u1", role: "STUDENT" }),
    res
  );

  const last = res.frames().at(-1);
  assert.equal(last.type, "error");
  assert.equal(last.message, "The assistant is temporarily unavailable. Please try again.");
  assert.ok(!last.message.includes("prisma"), "no ORM internals");
  assert.ok(!last.message.includes("Orange Tree"), "no file paths");
  assert.ok(!last.message.includes("fkey"), "no schema names");
});

test("a 4xx application error keeps its own safe message", async () => {
  streamTurnImpl = async () => {
    const err = new Error("You must be enrolled in this course to use the assistant for its learning content.");
    err.statusCode = 403;
    throw err;
  };

  const res = makeRes();
  await controller.streamConversationMessage(
    makeReq({ message: "hi" }, { conversationId: "c1" }, { id: "u1", role: "STUDENT" }),
    res
  );
  assert.match(res.frames().at(-1).message, /must be enrolled/);
});

test("a client disconnect aborts and emits no error frame", async () => {
  let observedSignal = null;
  streamTurnImpl = async ({ signal, onToken }) => {
    observedSignal = signal;
    onToken("partial");
    // The client goes away mid-generation.
    res.emit("close");
    const err = new Error("Request aborted.");
    err.isAbort = true;
    throw err;
  };

  const res = makeRes();
  await controller.streamGuestMessage(makeReq({ message: "hi", courseId: "c" }), res);

  const frames = res.frames();
  assert.equal(frames.filter((f) => f.type === "error").length, 0, "no error frame after a client disconnect");
  assert.equal(observedSignal.aborted, true, "the abort must propagate to the service");
  assert.equal(res.writableEnded, true);
});

test("an AbortSignal is always passed down to the service", async () => {
  streamTurnImpl = async () => ({ requestId: "r", conversationId: null, scope: "GUEST", model: "m" });
  const res = makeRes();
  await controller.streamGuestMessage(makeReq({ message: "hi", courseId: "c" }), res);
  assert.ok(lastStreamArgs.signal, "signal must be provided");
  assert.equal(typeof lastStreamArgs.signal.aborted, "boolean");
});

test("the guest endpoint never passes a user or a conversation id", async () => {
  streamTurnImpl = async () => ({ requestId: "r", conversationId: null, scope: "GUEST", model: "m" });
  const res = makeRes();
  await controller.streamGuestMessage(
    // Even if a client tries to smuggle one in.
    makeReq({ message: "hi", courseId: "c" }, { conversationId: "conv-x" }, { id: "u1", role: "ADMIN" }),
    res
  );
  assert.equal(lastStreamArgs.user, null, "guest turns are always anonymous");
  assert.equal(lastStreamArgs.conversationId, null, "guest turns are stateless");
});

/* ======================= validation layer ======================= */

test("SECURITY: quizId and assignmentId are stripped from the payload", () => {
  const { value, error } = conversationMessageSchema.validate({
    message: "What is the answer?",
    courseId: "c1",
    lessonId: "l1",
    quizId: "quiz-1",
    assignmentId: "asg-1",
    correctAnswer: "B",
  });
  assert.equal(error, undefined);
  assert.equal(value.quizId, undefined, "quizId must never reach the service");
  assert.equal(value.assignmentId, undefined, "assignmentId must never reach the service");
  assert.equal(value.correctAnswer, undefined);
  assert.equal(value.lessonId, "l1", "legitimate position ids survive");
});

test("an over-long message is rejected", () => {
  const { error } = conversationMessageSchema.validate({ message: "x".repeat(4001) });
  assert.ok(error);
  assert.match(error.message, /cannot exceed/);
});

test("an empty or missing message is rejected", () => {
  assert.ok(conversationMessageSchema.validate({ message: "   " }).error);
  assert.ok(conversationMessageSchema.validate({}).error);
});

test("the guest endpoint accepts messages with or without a courseId", () => {
  assert.equal(guestMessageSchema.validate({ message: "hi" }).error, undefined);
  assert.equal(guestMessageSchema.validate({ message: "hi", courseId: "c1" }).error, undefined);
});

test("contentIds is capped to 20 entries", () => {
  const { error } = conversationMessageSchema.validate({
    message: "hi",
    contentIds: Array.from({ length: 21 }, (_, i) => `c${i}`),
  });
  assert.ok(error);
});

test("conversation status is restricted to the known values", () => {
  assert.equal(updateConversationSchema.validate({ status: "ARCHIVED" }).error, undefined);
  assert.ok(updateConversationSchema.validate({ status: "DELETED_BY_ADMIN" }).error);
});

test("an empty update is rejected", () => {
  assert.ok(updateConversationSchema.validate({}).error);
});
