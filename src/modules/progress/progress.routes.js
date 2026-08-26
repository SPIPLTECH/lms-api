const express = require("express");

const router = express.Router();

const controller = require(
  "./progress.controller"
);

const verifyToken = require(
  "../../middleware/auth.middleware"
);
const validate = require("../../middleware/joiValidation.middleware");
const { completeLessonSchema, markContentVisitedSchema } = require("./progress.validation");

router.get(
  "/",
  verifyToken,
  controller.getProgress
);

router.post(
  "/complete",
  verifyToken,
  validate(completeLessonSchema),
  controller.completeLesson
);

router.post(
  "/content-visited",
  verifyToken,
  validate(markContentVisitedSchema),
  controller.markContentVisited
);

module.exports = router;