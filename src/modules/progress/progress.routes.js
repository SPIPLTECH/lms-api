const express = require("express");

const router = express.Router();

const controller = require(
  "./progress.controller"
);

const verifyToken = require(
  "../../middleware/auth.middleware"
);

router.get(
  "/",
  verifyToken,
  controller.getProgress
);

router.post(
  "/complete",
  verifyToken,
  controller.completeLesson
);

module.exports = router;