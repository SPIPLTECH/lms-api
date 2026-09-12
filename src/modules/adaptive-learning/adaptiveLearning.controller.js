const adaptiveLearningService = require("./adaptiveLearning.service");

const respond = async (req, res, next) => {
  try {
    const result = await adaptiveLearningService.respond({
      callingUser: req.user,
      data: req.body,
    });

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

// Streaming counterpart to respond(). Runs the exact same decision +
// educational-context + prompt-building steps (via adaptiveLearningService),
// only swapping the buffered LLM call for the streaming one so the browser
// can render tokens as Ollama produces them instead of waiting ~25-50s for
// the full response. SSE payloads carry their own `type` field
// (chunk/done/error) rather than relying on the `event:` line, so the
// frontend only needs to parse `data:` blocks.
const respondStream = async (req, res) => {
  const abortController = new AbortController();

  // res.on("close") — not req.on("close") — is the reliable signal for a
  // client disconnecting mid-response in Express: `req`'s "close" can fire
  // as soon as the request body has been fully read (i.e. right after
  // express.json() parses it), well before the response is done.
  req.on("close", () => {
    if (req.aborted || !res.writable) {
      abortController.abort();
    }
  });

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const sendEvent = (type, payload) => {
    res.write(`data: ${JSON.stringify({ type, ...payload })}\n\n`);
  };

  try {
    const result = await adaptiveLearningService.respondStream({
      callingUser: req.user,
      data: req.body,
      onToken: (content) => sendEvent("chunk", { content }),
      signal: abortController.signal,
    });

    sendEvent("done", { result });
  } catch (error) {
    // Client already disconnected (we aborted the upstream call ourselves) —
    // nothing to send, and the response may already be closing.
    if (!abortController.signal.aborted) {
      console.error("Adaptive learning stream failed:", error);
      sendEvent("error", { message: error.message || "Adaptive learning generation failed." });
    }
  } finally {
    res.end();
  }
};

const generateVerificationQuestion = async (req, res, next) => {
  try {
    const result = await adaptiveLearningService.generateVerificationQuestion({
      callingUser: req.user,
      data: req.body,
    });

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

const evaluateVerificationAnswer = async (req, res, next) => {
  try {
    const result = await adaptiveLearningService.evaluateVerificationAnswer({
      callingUser: req.user,
      data: req.body,
    });

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  respond,
  respondStream,
  generateVerificationQuestion,
  evaluateVerificationAnswer,
};
