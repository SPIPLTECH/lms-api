const express = require("express");
const router = express.Router();

const controller = require("./lessonQuery.controller");
const verifyToken = require("../../middleware/auth.middleware");
const checkRole = require("../../middleware/role.middleware");
const verifyLessonOwnership = require("../../middleware/lessonOwnership.middleware");
const validate = require("../../middleware/joiValidation.middleware");
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

router.post(
  "/",
  verifyToken,
  checkRole(["STUDENT"]),
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
