const express = require("express");

const router = express.Router();

const authController = require("./auth.controller");
const verifyToken = require(
  "../../middleware/auth.middleware"
);

const { authRateLimiter, passwordResetRateLimiter } = require("../../middleware/rateLimit.middleware");

const validate = require("../../middleware/joiValidation.middleware");
const {
  registerSchema,
  loginSchema,
  verifyOtpSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema,
  resendVerificationSchema,
} = require("./auth.validation");

/**
 * Public Routes
 */
router.post(
  "/register",
  authRateLimiter,
  validate(registerSchema),
  authController.register
);

router.post(
  "/login",
  authRateLimiter,
  validate(loginSchema),
  authController.login
);

router.post(
  "/verify-otp",
  authRateLimiter,
  validate(verifyOtpSchema),
  authController.verifyOtp
);

router.post(
  "/resend-verification",
  passwordResetRateLimiter,
  validate(resendVerificationSchema),
  authController.resendVerification
);

router.post(
  "/forgot-password",
  passwordResetRateLimiter,
  validate(forgotPasswordSchema),
  authController.forgotPassword
);

router.post(
  "/change-password",
  verifyToken,
  validate(changePasswordSchema),
  authController.changePassword
);

router.post(
  "/reset-password",
  passwordResetRateLimiter,
  validate(resetPasswordSchema),
  authController.resetPassword
);

router.post(
  "/refresh-token",
  authController.refreshToken
);

/**
 * Protected Routes
 */
router.get(
  "/profile",
  verifyToken,
  authController.profile
);

router.post(
  "/logout",
  verifyToken,
  authController.logout
);

module.exports = router;