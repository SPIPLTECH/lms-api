const express = require("express");
const rateLimit = require("express-rate-limit");

const verifyToken = require("../../middleware/auth.middleware");
const validate = require("../../middleware/joiValidation.middleware");
const { authRateLimiter } = require("../../middleware/rateLimit.middleware");
const controller = require("./evaluator.controller");
const {
  registerEvaluatorSchema,
  sendEmailCodeSchema,
  verifyEmailCodeSchema,
} = require("./evaluator.validation");

const router = express.Router();

// Each check may call the feedback site; keep one account from hammering it.
const feedbackCheckRateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `evaluator-feedback:${req.user.id}`,
  message: {
    success: false,
    message: "Too many checks. Please wait a few minutes and try again.",
  },
});

// Each send emails someone; keep one client from spamming inboxes.
const emailCodeSendRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many codes requested. Please wait a few minutes and try again.",
  },
});

// Guessing is also capped per code (see emailVerification MAX_ATTEMPTS).
const emailCodeVerifyRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many attempts. Please wait a few minutes and try again.",
  },
});

/**
 * Public. Registration is verify-first: send a code, verify it, then create
 * the account with the token the verification returned.
 */
router.get("/registration", controller.registrationInfo);

router.post("/email-code", emailCodeSendRateLimiter, validate(sendEmailCodeSchema), controller.sendEmailCode);

router.post(
  "/email-code/verify",
  emailCodeVerifyRateLimiter,
  validate(verifyEmailCodeSchema),
  controller.verifyEmailCode
);

router.post("/register", authRateLimiter, validate(registerEvaluatorSchema), controller.register);

/**
 * The signed-in evaluator. verifyToken lets /evaluators/* through for an
 * expired evaluator (see utils/evaluatorAccess), so these keep working
 * while learning access is closed.
 */
router.get("/me/status", verifyToken, controller.status);

router.post("/me/feedback-check", verifyToken, feedbackCheckRateLimiter, controller.checkFeedback);

module.exports = router;
