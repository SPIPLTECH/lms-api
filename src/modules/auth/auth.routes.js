const express = require("express");

const router = express.Router();

const authController = require("./auth.controller");
const verifyToken = require(
  "../../middleware/auth.middleware"
);

const { authRateLimiter, passwordResetRateLimiter, refreshRateLimiter } = require("../../middleware/rateLimit.middleware");

const validate = require("../../middleware/joiValidation.middleware");
const {
  registerSchema,
  loginSchema,
  googleLoginSchema,
  verifyOtpSchema,
  forgotPasswordSchema,
  verifyResetOtpSchema,
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
  "/google",
  authRateLimiter,
  validate(googleLoginSchema),
  authController.googleLogin
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
  "/verify-reset-otp",
  authRateLimiter,
  validate(verifyResetOtpSchema),
  authController.verifyResetOtp
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
  refreshRateLimiter,
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

// No verifyToken: logging out must work with an expired access token or
// with only the refresh credential left. The controller finds the session
// from either and ends it; an unknown session is a no-op.
router.post(
  "/logout",
  authController.logout
);

module.exports = router;
