const ApiError = require("../../utils/ApiError");
const { isProctoringAvailable } = require("../../config/proctoring");
const { getAiServiceHealth } = require("./ai/health");
const { analysisQueue } = require("./aiQueue");
const attempts = require("./attempt.service");
const evidence = require("./evidence.service");
const monitor = require("./monitor.service");
const registry = require("./monitorRegistry");
const { snapshotFieldsSchema } = require("./proctoring.validation");

const respond = (handler, status = 200) => async (req, res, next) => {
  try {
    res.status(status).json({ success: true, data: await handler(req) });
  } catch (error) {
    next(error);
  }
};

async function snapshot(req) {
  const { value, error } = snapshotFieldsSchema.validate(req.body, { stripUnknown: true });
  if (error) {
    await evidence.removeFile(req.file.path);
    throw new ApiError(400, "This upload could not be read.", "FRAME_INVALID");
  }
  return monitor.ingestFrame(req.monitor, req.file, value);
}

async function evidenceFile(req, res, next) {
  try {
    const { bytes, mimeType } = await evidence.readEvidenceFile(req.user, req.params.evidenceId);
    res.set({ "Content-Type": mimeType, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Disposition": "inline" });
    res.send(bytes);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getStatus: respond((req) => attempts.getStatus(req.user, req.params.quizId, req.headers)),
  createAttempt: respond((req) => attempts.createAttempt(req.user, req.params.quizId, req.body, req.headers), 201),
  resumeAttempt: respond((req) => attempts.resumeAttempt(req.user, req.params.attemptId, req.headers)),
  startAttempt: respond((req) => attempts.startAttempt(req.user, req.params.attemptId)),
  getAttempt: respond((req) => attempts.getAttempt(req.user, req.params.attemptId)),
  saveAnswer: respond((req) => attempts.saveAnswer(req.user, req.params.attemptId, req.params.questionId, req.body)),
  submitAttempt: respond((req) => attempts.submitAttempt(req.user, req.params.attemptId)),
  getAttemptResult: respond((req) => attempts.getAttemptResult(req.user, req.params.attemptId)),
  snapshot: respond(snapshot),
  monitorEvent: respond((req) => monitor.ingestEvent(req.monitor, req.body)),
  heartbeat: respond((req) => monitor.heartbeat(req.monitor, req.body)),
  context: respond((req) => monitor.context(req.monitor)),
  evidenceFile,
  // No URLs, tokens or paths: state and numbers only.
  health: respond(async () => ({
    available: isProctoringAvailable(),
    ai: await getAiServiceHealth(),
    queue: analysisQueue.metrics(),
    monitors: registry.all().filter((item) => !item.ended).length,
  })),
};
