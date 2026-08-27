const mentorService = require("./mentor.service");

const createConversation = async (req, res, next) => {
  try {
    const conversation = await mentorService.createConversation(req.user, req.body.title);
    return res.status(201).json({
      success: true,
      data: conversation,
    });
  } catch (error) {
    next(error);
  }
};

const getUserConversations = async (req, res, next) => {
  try {
    const conversations = await mentorService.getUserConversations(req.user);
    return res.status(200).json({
      success: true,
      data: conversations,
    });
  } catch (error) {
    next(error);
  }
};

const getConversationMessages = async (req, res, next) => {
  try {
    const messages = await mentorService.getConversationMessages(
      req.user,
      req.params.conversationId
    );
    return res.status(200).json({
      success: true,
      data: messages,
    });
  } catch (error) {
    next(error);
  }
};

const sendMessage = async (req, res, next) => {
  try {
    const result = await mentorService.processUserMessage(
      req.user,
      req.params.conversationId,
      req.body.content,
      { quizId: req.body.quizId, courseId: req.body.courseId }
    );
    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

const sendMessageStream = async (req, res) => {
  const abortController = new AbortController();

  res.on("close", () => {
    if (!res.writableEnded) {
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
    const result = await mentorService.processUserMessageStream(
      req.user,
      req.params.conversationId,
      req.body.content,
      { quizId: req.body.quizId, courseId: req.body.courseId },
      {
        onToken: (content) => sendEvent("chunk", { content }),
        signal: abortController.signal,
      }
    );

    sendEvent("done", { result });
  } catch (error) {
    if (!abortController.signal.aborted) {
      console.error("Mentor stream error:", error.message);
      sendEvent("error", {
        message: error.message || "Mentor stream failed.",
        statusCode: error.statusCode || 500,
      });
    }
  } finally {
    res.end();
  }
};

module.exports = {
  createConversation,
  getUserConversations,
  getConversationMessages,
  sendMessage,
  sendMessageStream,
};
