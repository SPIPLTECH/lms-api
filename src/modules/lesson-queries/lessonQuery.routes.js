const express = require("express");
const router = express.Router();

const controller = require("./lessonQuery.controller");
const verifyToken = require("../../middleware/auth.middleware");
const checkRole = require("../../middleware/role.middleware");
const verifyLessonOwnership = require("../../middleware/lessonOwnership.middleware");
const validate = require("../../middleware/joiValidation.middleware");
const requireContentAccess = require("../../middleware/contentAccess.middleware");
const {
  createLessonQuerySchema,
  replyLessonQuerySchema,
  updateStatusSchema
} = require("./lessonQuery.validation");

router.get(
  "/",
  verifyToken,
  checkRole(["INSTRUCTOR", "ADMIN"]),
  verifyLessonOwnership.fromQuery,
  controller.getQueries
);

router.get(
  "/mine",
  verifyToken,
  checkRole(["INSTRUCTOR", "ADMIN"]),
  controller.getMyQueries
);

// Student reads their own questions — course-content exposure; gated while
// another device of the same account holds the playback lease.
router.get(
  "/my-questions",
  verifyToken,
  checkRole(["STUDENT"]),
  requireContentAccess,
  controller.getMyQuestions
);

// Student submits a lesson query while on a lesson — course-content action.
router.post(
  "/",
  verifyToken,
  checkRole(["STUDENT"]),
  requireContentAccess,
  validate(createLessonQuerySchema),
  controller.createQuery
);

router.patch(
  "/:queryId/reply",
  verifyToken,
  checkRole(["INSTRUCTOR", "ADMIN"]),
  validate(replyLessonQuerySchema),
  controller.replyToQuery
);

router.patch(
  "/:queryId/status",
  verifyToken,
  checkRole(["INSTRUCTOR", "ADMIN"]),
  validate(updateStatusSchema),
  controller.updateStatus
);

module.exports = router;
