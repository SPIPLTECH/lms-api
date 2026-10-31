const attempts = require("./attempt.service");

const respond = (handler, status = 200) => async (req, res, next) => {
  try {
    res.status(status).json({ success: true, data: await handler(req) });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getStatus: respond((req) => attempts.getStatus(req.user, req.params.quizId, req.headers)),
  createAttempt: respond((req) => attempts.createAttempt(req.user, req.params.quizId, req.body, req.headers), 201),
  resumeAttempt: respond((req) => attempts.resumeAttempt(req.user, req.params.attemptId, req.headers)),
  startAttempt: respond((req) => attempts.startAttempt(req.user, req.params.attemptId)),
  getAttempt: respond((req) => attempts.getAttempt(req.user, req.params.attemptId)),
  saveAnswer: respond((req) => attempts.saveAnswer(req.user, req.params.attemptId, req.params.questionId, req.body)),
  submitAttempt: respond((req) => attempts.submitAttempt(req.user, req.params.attemptId)),
};
