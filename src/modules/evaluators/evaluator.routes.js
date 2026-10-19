const express = require("express");
const rateLimit = require("express-rate-limit");

const verifyToken = require("../../middleware/auth.middleware");
const checkRole = require("../../middleware/role.middleware");
const validate = require("../../middleware/joiValidation.middleware");
const { authRateLimiter } = require("../../middleware/rateLimit.middleware");
const controller = require("./evaluator.controller");
const { registerEvaluatorSchema, confirmFeedbackSchema } = require("./evaluator.validation");

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

/**
 * Public
 */
router.get("/registration", controller.registrationInfo);

router.post("/register", authRateLimiter, validate(registerEvaluatorSchema), controller.register);

/**
 * The signed-in evaluator. verifyToken lets /evaluators/* through for a
 * blocked evaluator (see utils/evaluatorAccess), so these keep working
 * while learning access is closed.
 */
router.get("/me/status", verifyToken, controller.status);

router.post("/me/feedback-check", verifyToken, feedbackCheckRateLimiter, controller.checkFeedback);

/**
 * Admin fallback: confirm a submission checked by hand on the feedback site.
 */
router.post(
  "/admin/confirm-feedback",
  verifyToken,
  checkRole(["ADMIN"]),
  validate(confirmFeedbackSchema),
  controller.adminConfirmFeedback
);

module.exports = router;
