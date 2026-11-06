const express = require("express");
const multer = require("multer");
const router = express.Router();

const controller = require("./question.controller");
const verifyToken = require("../../middleware/auth.middleware");
const checkRole = require("../../middleware/role.middleware");
const validate = require("../../middleware/joiValidation.middleware");
const { importUpload, questionBufferUpload, validateUploadedFileSignature } = require("../../middleware/upload.middleware");
const requireContentAccess = require("../../middleware/contentAccess.middleware");
const {
  createQuestionSchema,
  updateQuestionSchema,
  bulkCreateQuestionsSchema
} = require("./question.validation");

// Question repository uploads use the strict allow-list & 20MB buffer cap
const upload = questionBufferUpload;

// =========================
// Question Repository Routes
// =========================

// The read routes below return whole Question rows — correctAnswer,
// explanation, hint and option flags included — so they are for the people
// who author questions. A student reads a quiz's questions only through
// GET /quizzes/:quizId, which withholds the answer key.
const AUTHORS = ["ADMIN", "INSTRUCTOR"];

// GET /questions - Paginated search and filter repository questions
router.get("/", verifyToken, checkRole(AUTHORS), requireContentAccess, controller.getQuestions);

// POST /questions/upload - Bulk file upload (Excel, CSV, JSON)
router.post(
  "/upload",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR"]),
  upload.single("file"),
  validateUploadedFileSignature,
  controller.uploadQuestions
);

// GET /questions/quiz/:quizId - Questions by Quiz ID
router.get("/quiz/:quizId", verifyToken, checkRole(AUTHORS), requireContentAccess, controller.getQuestionsByQuizId);

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
  validateUploadedFileSignature,
  controller.importQuestionsFile
);

// POST /questions/import/preview - Parse an uploaded file and return its
// questions for review in the composer's quiz editor. Writes nothing; the
// chosen questions are saved with the quiz.
router.post(
  "/import/preview",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR"]),
  importUpload.single("file"),
  validateUploadedFileSignature,
  controller.previewImportFile
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
router.get("/:quizId", verifyToken, checkRole(AUTHORS), requireContentAccess, controller.getQuestionsByQuizId);

module.exports = router;
