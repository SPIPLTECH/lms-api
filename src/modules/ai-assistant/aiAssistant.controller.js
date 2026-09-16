const aiAssistantService = require("./aiAssistant.service");
const { LIMITS } = require("./constants/aiAssistant.constants");

/* ------------------------------------------------------------------ */
/* SSE plumbing                                                        */
/* ------------------------------------------------------------------ */

/**
 * Opens an SSE response and returns a writer.
 *
 * Wire format matches the live adaptive-learning stream exactly
 * (`data: {"type":...}\n\n`), so the frontend has one parser for both.
 */
const openStream = (res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    // Stops nginx buffering the stream into one lump.
    "X-Accel-Buffering": "no",
  });
  // Flush headers immediately so the client's reader resolves before the
  // first token, rather than waiting on the model.
  if (typeof res.flushHeaders === "function") res.flushHeaders();

  return (type, payload) => {
    if (res.writableEnded) return;
    res.write("data: " + JSON.stringify({ type, ...payload }) + "\n\n");
  };
};

/**
 * Shared streaming handler for both the guest and authenticated endpoints.
 *
 * Errors are the sensitive part. Everything a client sees here is either a
 * message this codebase authored (ApiError / the Gemini provider's classified
 * messages) or a fixed fallback — never a Prisma error, a raw SDK string, a
 * stack trace, or a file path. `requestId` is the only handle given out, and
 * it correlates with the server-side log.
 */
const runStream = async (req, res, { user, conversationId }) => {
  const abortController = new AbortController();

  // res.on("close") — not req.on("close") — is the reliable client-disconnect
  // signal in Express: req's "close" can fire as soon as the body is parsed.
  res.on("close", () => {
    if (!res.writableEnded) abortController.abort();
  });

  // Whole-turn ceiling, independent of the provider's own deadline.
  const timeout = setTimeout(() => abortController.abort(), LIMITS.REQUEST_TIMEOUT_MS);

  const send = openStream(res);
  let requestId = null;

  try {
    const { message, courseId, moduleId, lessonId, topicId, contentIds } = req.body;

    const result = await aiAssistantService.streamTurn({
      user,
      conversationId,
      message,
      courseId,
      position: { moduleId, lessonId, topicId, contentIds },
      onToken: (content) => send("chunk", { content }),
      signal: abortController.signal,
    });

    requestId = result.requestId;
    send("done", { result });
  } catch (error) {
    requestId = error.requestId || requestId;

    // Client went away; nothing to report and the socket is already closing.
    if (abortController.signal.aborted || error.isAbort) {
      console.warn("[ai-assistant] stream aborted", JSON.stringify({ requestId }));
    } else {
      console.error(
        "[ai-assistant] stream error " +
          JSON.stringify({
            requestId,
            code: error.code || null,
            statusCode: error.statusCode || 500,
            message: error.message,
          })
      );

      // Only surface a message we wrote ourselves. An unclassified error
      // (Prisma, a TypeError, anything unexpected) collapses to a generic
      // string so internals never reach the browser.
      const safeMessage =
        error.statusCode && error.statusCode < 500
          ? error.message
          : error.code && String(error.code).startsWith("GEMINI_")
            ? error.message
            : "The assistant is temporarily unavailable. Please try again.";

      send("error", {
        message: safeMessage,
        code: error.code || undefined,
        requestId: requestId || undefined,
      });
    }
  } finally {
    clearTimeout(timeout);
    if (!res.writableEnded) res.end();
  }
};

/* ------------------------------------------------------------------ */
/* Handlers                                                            */
/* ------------------------------------------------------------------ */

/**
 * Guest / anonymous turn. Stateless: no conversation row, no history, nothing
 * persisted. `optionalToken` means a signed-in user may also land here; the
 * service still resolves their real scope, so a signed-in visitor gets
 * BROWSING rather than GUEST — but either way nothing is written.
 */
const streamGuestMessage = async (req, res) => {
  await runStream(req, res, { user: null, conversationId: null });
};

const streamConversationMessage = async (req, res) => {
  await runStream(req, res, {
    user: req.user,
    conversationId: req.params.conversationId,
  });
};

const createConversation = async (req, res, next) => {
  try {
    const conversation = await aiAssistantService.createConversation(req.user, req.body);
    return res.status(201).json({ success: true, data: conversation });
  } catch (error) {
    next(error);
  }
};

const listConversations = async (req, res, next) => {
  try {
    // Express 5 exposes req.query as a getter, so it cannot be reassigned by
    // the Joi middleware. Sanitised here instead.
    const courseId =
      typeof req.query.courseId === "string" && req.query.courseId.trim()
        ? req.query.courseId.trim().slice(0, 64)
        : undefined;
    const status = req.query.status === "ARCHIVED" || req.query.status === "ACTIVE"
      ? req.query.status
      : undefined;

    const conversations = await aiAssistantService.listConversations(req.user, { courseId, status });
    return res.status(200).json({ success: true, data: conversations });
  } catch (error) {
    next(error);
  }
};

const getConversationMessages = async (req, res, next) => {
  try {
    const messages = await aiAssistantService.getMessages(req.user, req.params.conversationId);
    return res.status(200).json({ success: true, data: messages });
  } catch (error) {
    next(error);
  }
};

const updateConversation = async (req, res, next) => {
  try {
    const conversation = await aiAssistantService.updateConversation(
      req.user,
      req.params.conversationId,
      req.body
    );
    return res.status(200).json({ success: true, data: conversation });
  } catch (error) {
    next(error);
  }
};

const deleteConversation = async (req, res, next) => {
  try {
    const result = await aiAssistantService.deleteConversation(req.user, req.params.conversationId);
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  streamGuestMessage,
  streamConversationMessage,
  createConversation,
  listConversations,
  getConversationMessages,
  updateConversation,
  deleteConversation,
};
