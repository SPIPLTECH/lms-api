const express = require("express");

const router = express.Router();

const authController = require("./auth.controller");

const verifyToken = require(
  "../../middleware/auth.middleware"
);

/**
 * Public Routes
 */
router.post(
  "/register",
  authController.register
);

router.post(
  "/login",
  authController.login
);

// router.get(
//   "/verify-email",
//   authController.verifyEmail
// );

router.post(
  "/forgot-password",
  authController.forgotPassword
);

router.post(
  "/reset-password",
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