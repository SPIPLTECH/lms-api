const express = require("express");
const router = express.Router();
const controller = require("./quiz.controller");
const verifyToken = require("../../middleware/auth.middleware");
const checkRole = require("../../middleware/role.middleware");
const verifyQuizOwnership = require("../../middleware/quizOwnership.middleware");
const verifyCourseOwnership = require("../../middleware/courseOwnership.middleware");
const validate = require("../../middleware/joiValidation.middleware");
const {
  createQuizSchema,
  updateQuizSchema,
  submitQuizSchema,
  importQuestionsToQuizSchema,
  reorderQuizQuestionsSchema,
  updateQuizQuestionMarksSchema,
  generateSelfAssessmentQuizSchema
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
  verifyCourseOwnership.fromBody,
  controller.createQuiz
);

router.put(
  "/:quizId",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR"]),
  verifyQuizOwnership,
  validate(updateQuizSchema),
  controller.updateQuiz
);

router.delete(
  "/:quizId",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR"]),
  verifyQuizOwnership,
  controller.deleteQuiz
);

router.post(
  "/:quizId/submit",
  verifyToken,
  validate(submitQuizSchema),
  controller.submitQuiz
);

router.post(
  "/self-generate",
  verifyToken,
  checkRole(["STUDENT"]),
  validate(generateSelfAssessmentQuizSchema),
  controller.generateSelfAssessmentQuiz
);

// =========================
// Question Repository Import Routes
// =========================

// POST /quizzes/:quizId/import-questions - Import selected repository questions
router.post(
  "/:quizId/import-questions",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR"]),
  verifyQuizOwnership,
  validate(importQuestionsToQuizSchema),
  controller.importQuestionsToQuiz
);

// DELETE /quizzes/:quizId/questions/:questionId - Remove question from quiz
router.delete(
  "/:quizId/questions/:questionId",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR"]),
  verifyQuizOwnership,
  controller.removeQuestionFromQuiz
);

// PUT /quizzes/:quizId/questions/reorder - Reorder questions inside quiz
router.put(
  "/:quizId/questions/reorder",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR"]),
  verifyQuizOwnership,
  validate(reorderQuizQuestionsSchema),
  controller.reorderQuizQuestions
);

// PUT /quizzes/:quizId/questions/:questionId/marks - Override question marks inside quiz
router.put(
  "/:quizId/questions/:questionId/marks",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR"]),
  verifyQuizOwnership,
  validate(updateQuizQuestionMarksSchema),
  controller.updateQuizQuestionMarks
);

module.exports = router;