const express = require("express");

const verifyToken = require("../../middleware/auth.middleware");
const checkRole = require("../../middleware/role.middleware");
const validate = require("../../middleware/joiValidation.middleware");
const {
  proctoringAttemptRateLimiter,
  proctoringAnswerRateLimiter,
  monitorRateLimiter,
} = require("../../middleware/rateLimit.middleware");
const { isProctoringAvailable } = require("../../config/proctoring");
const controller = require("./proctoring.controller");
const { monitorAuth, receiveFrame } = require("./monitor.middleware");
const { appealSchema, createAttemptSchema, decisionSchema, deleteEvidenceSchema, heartbeatSchema, monitorEventSchema, saveAnswerSchema } = require("./proctoring.validation");

const router = express.Router();

// Whether the checkbox should be offered at all.
router.get("/config", verifyToken, (req, res) => {
  res.json({ success: true, data: { available: isProctoringAvailable() } });
});

// The exam routes deliberately skip requireContentAccess: a video lease on another
// device must never stop a student saving or submitting. Beginning an exam checks
// the lease itself.
const student = [verifyToken, checkRole(["STUDENT"])];

router.get("/quizzes/:quizId/status", student, proctoringAttemptRateLimiter, controller.getStatus);
router.post("/quizzes/:quizId/attempts", student, proctoringAttemptRateLimiter, validate(createAttemptSchema), controller.createAttempt);
router.get("/attempts/:attemptId", student, proctoringAttemptRateLimiter, controller.getAttempt);
router.post("/attempts/:attemptId/resume", student, proctoringAttemptRateLimiter, controller.resumeAttempt);
router.post("/attempts/:attemptId/start", student, proctoringAttemptRateLimiter, controller.startAttempt);
router.put("/attempts/:attemptId/answers/:questionId", student, proctoringAnswerRateLimiter, validate(saveAnswerSchema), controller.saveAnswer);
router.post("/attempts/:attemptId/submit", student, proctoringAttemptRateLimiter, controller.submitAttempt);
router.get("/attempts/:attemptId/result", student, proctoringAttemptRateLimiter, controller.getAttemptResult);
router.post("/attempts/:attemptId/review-requests", student, proctoringAttemptRateLimiter, validate(appealSchema), controller.createAppeal);

// Reviews: the service checks an instructor owns the course. An admin can see them all.
const staff = [verifyToken, checkRole(["INSTRUCTOR", "ADMIN"])];
router.get("/reviews", staff, controller.listReviews);
router.get("/reviews/:attemptId", staff, controller.getReview);
router.post("/reviews/:attemptId/decision", staff, validate(decisionSchema), controller.decide);
router.delete("/attempts/:attemptId/evidence", verifyToken, checkRole(["ADMIN"]), validate(deleteEvidenceSchema), controller.deleteAttemptEvidence);

// Monitoring: the attempt's own token, checked in memory, so a clean frame costs the
// database nothing. Limits are per attempt, so one classroom behind one address is not
// throttled as a single client. A frame every 5 s plus 2 s re-checks stays well inside them.
router.post("/monitor/snapshots", monitorAuth, monitorRateLimiter("snapshots", 60), receiveFrame, controller.snapshot);
router.post("/monitor/events", monitorAuth, monitorRateLimiter("events", 120), validate(monitorEventSchema), controller.monitorEvent);
router.post("/monitor/heartbeat", monitorAuth, monitorRateLimiter("heartbeat", 30), validate(heartbeatSchema), controller.heartbeat);
router.get("/monitor/context", monitorAuth, monitorRateLimiter("context", 30), controller.context);

// Images reach people only here, never through the LMS file routes or a public URL.
router.get("/evidence/:evidenceId/file", verifyToken, checkRole(["STUDENT", "INSTRUCTOR", "ADMIN"]), proctoringAttemptRateLimiter, controller.evidenceFile);

router.get("/health", verifyToken, checkRole(["ADMIN"]), controller.health);

module.exports = router;
