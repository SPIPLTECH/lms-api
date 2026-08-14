const mentorService = require("../services/mentor.service");
const { successResponse } = require("../../../utils/response");

const chat = async (req, res, next) => {
  try {
    const result = await mentorService.chat(req.mentorActor, req.body);
    return successResponse(res, result, "Mentor reply generated");
  } catch (error) {
    next(error);
  }
};

/**
 * No SSE precedent exists anywhere in this codebase — this is the first
 * one, plain Express (`text/event-stream` + manual `res.write`), since
 * `POST /mentor/stream` is specified as an HTTP endpoint, not a socket
 * event (Socket.IO here is purpose-built for the unrelated human chat
 * feature — see this module's index.js doc for the full reasoning).
 * Each real token delta (or the whole fallback text, when no LLM is
 * configured) is forwarded as its own `data:` event; a final `event: done`
 * carries the persisted message/conversation ids once the turn completes.
 */
const stream = async (req, res, next) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const sendEvent = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const result = await mentorService.streamChat(req.mentorActor, req.body, (textDelta) => sendEvent("chunk", { text: textDelta }));
    sendEvent("done", result);
  } catch (error) {
    sendEvent("error", { message: error.message || "Something went wrong" });
  } finally {
    res.end();
  }
};

const getHistory = async (req, res, next) => {
  try {
    const result = await mentorService.getHistory(req.mentorActor, req.query);
    return successResponse(res, result, "Conversation history fetched");
  } catch (error) {
    next(error);
  }
};

const getContext = async (req, res, next) => {
  try {
    const result = await mentorService.getContext(req.mentorActor);
    return successResponse(res, result, "Mentor context fetched");
  } catch (error) {
    next(error);
  }
};

const getRecommendations = async (req, res, next) => {
  try {
    const result = await mentorService.getRecommendations(req.mentorActor);
    return successResponse(res, result, "Mentor recommendations fetched");
  } catch (error) {
    next(error);
  }
};

const getConversation = async (req, res, next) => {
  try {
    const result = await mentorService.getConversationDetail(req.mentorActor, req.params.id);
    return successResponse(res, result, "Conversation fetched");
  } catch (error) {
    next(error);
  }
};

const deleteConversation = async (req, res, next) => {
  try {
    const result = await mentorService.deleteConversation(req.mentorActor, req.params.id);
    return successResponse(res, result, "Conversation deleted");
  } catch (error) {
    next(error);
  }
};

const submitFeedback = async (req, res, next) => {
  try {
    const result = await mentorService.submitFeedback(req.mentorActor, req.body);
    return successResponse(res, result, "Feedback recorded", 201);
  } catch (error) {
    next(error);
  }
};

module.exports = { chat, stream, getHistory, getContext, getRecommendations, getConversation, deleteConversation, submitFeedback };
