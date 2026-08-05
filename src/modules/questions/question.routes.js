const express = require("express");
const multer = require("multer");
const router = express.Router();

const controller = require("./question.controller");
const verifyToken = require("../../middleware/auth.middleware");
const checkRole = require("../../middleware/role.middleware");
const validate = require("../../middleware/joiValidation.middleware");
const { importUpload } = require("../../middleware/upload.middleware");
const {
  createQuestionSchema,
  updateQuestionSchema,
  bulkCreateQuestionsSchema
} = require("./question.validation");

// Multer memory storage for handling Excel, CSV, JSON file upload buffers
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB
  },
});

// =========================
// Question Repository Routes
// =========================

// GET /questions - Paginated search and filter repository questions
router.get("/", verifyToken, controller.getQuestions);

// POST /questions/upload - Bulk file upload (Excel, CSV, JSON)
router.post(
  "/upload",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR"]),
  upload.single("file"),
  controller.uploadQuestions
);

// GET /questions/question/:questionId - Single question details & quiz usage
router.get("/question/:questionId", verifyToken, controller.getQuestionById);

// GET /questions/quiz/:quizId - Questions by Quiz ID
router.get("/quiz/:quizId", verifyToken, controller.getQuestionsByQuizId);

// POST /questions - Manual single question creation
router.post(
  "/",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR"]),
  validate(createQuestionSchema),
  controller.createQuestion
);

// POST /questions/bulk - Bulk create from a JSON payload, optionally attached to a quiz
router.post(
  "/bulk",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR"]),
  validate(bulkCreateQuestionsSchema),
  controller.bulkCreateQuestions
);

// POST /questions/import - Bulk create from an uploaded file, optionally attached to a quiz
router.post(
  "/import",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR"]),
  importUpload.single("file"),
  controller.importQuestionsFile
);

// POST /questions/:questionId/archive - Archive question
router.post(
  "/:questionId/archive",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR"]),
  controller.archiveQuestion
);

// POST /questions/:questionId/duplicate - Duplicate question
router.post(
  "/:questionId/duplicate",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR"]),
  controller.duplicateQuestion
);

// PUT /questions/:questionId - Update question
router.put(
  "/:questionId",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR"]),
  validate(updateQuestionSchema),
  controller.updateQuestion
);

// DELETE /questions/:questionId - Delete or soft archive question
router.delete(
  "/:questionId",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR"]),
  controller.deleteQuestion
);

// Fallback GET /questions/:quizId
router.get("/:quizId", verifyToken, controller.getQuestionsByQuizId);

module.exports = router;