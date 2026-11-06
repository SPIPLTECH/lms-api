const express = require("express");

const router = express.Router();

const controller = require("./feedback.controller");
const verifyToken = require("../../middleware/auth.middleware");
const checkRole = require("../../middleware/role.middleware");

// Student submissions
router.post(
  "/courses/:courseId",
  verifyToken,
  checkRole(["STUDENT"]),
  controller.submitFeedback
);

router.post(
  "/",
  verifyToken,
  checkRole(["STUDENT"]),
  controller.submitFeedback
);

// Student check existing feedback & completion status
router.get(
  "/courses/:courseId/my",
  verifyToken,
  controller.getMyFeedback
);

router.get(
  "/my",
  verifyToken,
  controller.getMyFeedback
);

// Instructor / Admin view course feedback
router.get(
  "/courses/:courseId",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR"]),
  controller.getCourseFeedback
);

router.get(
  "/",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR"]),
  controller.getCourseFeedback
);

module.exports = router;
