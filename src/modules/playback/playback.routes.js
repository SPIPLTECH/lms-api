const express = require("express");

const router = express.Router();

const controller = require("./playback.controller");
const verifyToken = require("../../middleware/auth.middleware");
const validate = require("../../middleware/joiValidation.middleware");
const { playbackStartRateLimiter } = require("../../middleware/rateLimit.middleware");
const { startPlaybackSchema, heartbeatSchema, stopPlaybackSchema } = require("./playback.validation");

// Every lease operation runs behind the full session gate (verifyToken):
// an ACTIVE session, inside its deadlines, from its bound device.
router.get("/status", verifyToken, controller.getStatus);

router.post(
  "/start",
  verifyToken,
  playbackStartRateLimiter,
  validate(startPlaybackSchema),
  controller.startPlayback
);

router.post("/heartbeat", verifyToken, validate(heartbeatSchema), controller.heartbeat);

router.post("/stop", verifyToken, validate(stopPlaybackSchema), controller.stopPlayback);

// Authorized by the signed, lease-bound token in the path, not by a header.
router.get("/media/:token", controller.streamMedia);

module.exports = router;
