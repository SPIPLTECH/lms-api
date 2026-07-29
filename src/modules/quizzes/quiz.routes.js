const express = require("express");
const router = express.Router();
const controller = require("./quiz.controller");
const verifyToken = require("../../middleware/auth.middleware");
const checkRole = require("../../middleware/role.middleware");
const validate = require("../../middleware/joiValidation.middleware");
const {
  createQuizSchema,
  updateQuizSchema,
  submitQuizSchema,
  importQuestionsToQuizSchema,
  reorderQuizQuestionsSchema,
  updateQuizQuestionMarksSchema
} = require("./quiz.validation");

// =========================
// Quiz Routes
// =========================

router.get(
  "/",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR", "STUDENT"]),
  controller.getQuizzes
);

router.get("/:quizId/result", verifyToken, controller.getQuizResult);

router.get(
  "/:quizId",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR", "STUDENT"]),
  controller.getQuizById
);

router.post(
  "/",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR"]),
  validate(createQuizSchema),
  controller.createQuiz
);

router.put(
  "/:quizId",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR"]),
  validate(updateQuizSchema),
  controller.updateQuiz
);

router.delete(
  "/:quizId",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR"]),
  controller.deleteQuiz
);

router.post(
  "/:quizId/submit",
  verifyToken,
  validate(submitQuizSchema),
  controller.submitQuiz
);

// =========================
// Question Repository Import Routes
// =========================

// POST /quizzes/:quizId/import-questions - Import selected repository questions
router.post(
  "/:quizId/import-questions",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR"]),
  validate(importQuestionsToQuizSchema),
  controller.importQuestionsToQuiz
);

// DELETE /quizzes/:quizId/questions/:questionId - Remove question from quiz
router.delete(
  "/:quizId/questions/:questionId",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR"]),
  controller.removeQuestionFromQuiz
);

// PUT /quizzes/:quizId/questions/reorder - Reorder questions inside quiz
router.put(
  "/:quizId/questions/reorder",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR"]),
  validate(reorderQuizQuestionsSchema),
  controller.reorderQuizQuestions
);

// PUT /quizzes/:quizId/questions/:questionId/marks - Override question marks inside quiz
router.put(
  "/:quizId/questions/:questionId/marks",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR"]),
  validate(updateQuizQuestionMarksSchema),
  controller.updateQuizQuestionMarks
);

module.exports = router;