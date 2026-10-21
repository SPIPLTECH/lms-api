const express = require("express");

const router = express.Router();

const controller = require("./session.controller");
const verifyToken = require("../../middleware/auth.middleware");
const { sessionStatusRateLimiter } = require("../../middleware/rateLimit.middleware");

router.get(
  "/me",
  verifyToken,
  sessionStatusRateLimiter,
  controller.getMySession
);

module.exports = router;
