const express = require("express");

const verifyToken = require("../../middleware/auth.middleware");
const checkRole = require("../../middleware/role.middleware");
const validate = require("../../middleware/joiValidation.middleware");
const { proctoringAttemptRateLimiter, proctoringAnswerRateLimiter } = require("../../middleware/rateLimit.middleware");
const { isProctoringAvailable } = require("../../config/proctoring");
const controller = require("./proctoring.controller");
const { createAttemptSchema, saveAnswerSchema } = require("./proctoring.validation");

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

module.exports = router;
