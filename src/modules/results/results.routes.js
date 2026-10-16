const express = require("express");
const router = express.Router();

const controller = require("./results.controller");
const verifyToken = require("../../middleware/auth.middleware");
const checkRole = require("../../middleware/role.middleware");

router.get(
  "/",
  verifyToken,
  checkRole(["INSTRUCTOR", "ADMIN"]),
  controller.getResults
);

// Quiz- and question-level analytics for one quiz (?quizId=). Aggregated in
// the database from the existing attempt records — see quizAnalytics.service.
// Instructor/admin only, and scoped again inside the service to courses the
// caller owns, so the role check here is not the only thing standing between
// an instructor and someone else's quiz.
router.get(
  "/quiz-analytics",
  verifyToken,
  checkRole(["INSTRUCTOR", "ADMIN"]),
  controller.getQuizAnalytics
);

// Grouped per Final test, rather than one row per attempt like GET /.
router.get(
  "/final-tests",
  verifyToken,
  checkRole(["INSTRUCTOR", "ADMIN"]),
  controller.getFinalTestOverview
);

module.exports = router;
