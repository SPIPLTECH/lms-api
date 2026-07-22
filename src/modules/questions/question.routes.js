const express = require("express");
const router = express.Router();

const controller = require("./question.controller");
const verifyToken = require("../../middleware/auth.middleware");
const checkRole = require("../../middleware/role.middleware");
const { importUpload } = require("../../middleware/upload.middleware");

// =========================
// Public Routes
// =========================

// Get all questions (optional ?quizId=...)
router.get("/", controller.getQuestions);

// Get questions by quiz id (explicit endpoint)
router.get("/quiz/:quizId", controller.getQuestionsByQuizId);

// Get question by id (explicit endpoint)
router.get("/question/:questionId", controller.getQuestionById);

// Get questions by quiz id or question by id (fallback for backward compatibility)
router.get("/:quizId", (req, res, next) => {
  // If request hits /:quizId, forward to getQuestionsByQuizId
  return controller.getQuestionsByQuizId(req, res, next);
});

// =========================
// Protected Routes
// =========================

// Create single question
router.post(
  "/",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR"]),
  controller.createQuestion
);

// Bulk create questions
router.post(
  "/bulk",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR"]),
  controller.bulkCreateQuestions
);

// Import questions from file
router.post(
  "/import",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR"]),
  importUpload.single("file"),
  controller.importQuestions
);

// Update question
router.put(
  "/:questionId",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR"]),
  controller.updateQuestion
);

// Delete question
router.delete(
  "/:questionId",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR"]),
  controller.deleteQuestion
);

module.exports = router;