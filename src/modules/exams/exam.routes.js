const express = require("express");
const router = express.Router();

const controller = require("./exam.controller");
const verifyToken = require("../../middleware/auth.middleware");
const checkRole = require("../../middleware/role.middleware");
const verifyExamOwnership = require("../../middleware/examOwnership.middleware");
const verifyCourseOwnership = require("../../middleware/courseOwnership.middleware");
const validate = require("../../middleware/joiValidation.middleware");
const { createExamSchema, updateExamSchema } = require("./exam.validation");

router.get(
  "/",
  verifyToken,
  checkRole(["INSTRUCTOR", "ADMIN"]),
  controller.getExams
);

router.get(
  "/:examId",
  verifyToken,
  checkRole(["INSTRUCTOR", "ADMIN"]),
  controller.getExamById
);

router.post(
  "/",
  verifyToken,
  checkRole(["INSTRUCTOR", "ADMIN"]),
  validate(createExamSchema),
  verifyCourseOwnership.fromBody,
  controller.createExam
);

router.put(
  "/:examId",
  verifyToken,
  checkRole(["INSTRUCTOR", "ADMIN"]),
  verifyExamOwnership,
  validate(updateExamSchema),
  controller.updateExam
);

router.delete(
  "/:examId",
  verifyToken,
  checkRole(["INSTRUCTOR", "ADMIN"]),
  verifyExamOwnership,
  controller.deleteExam
);

module.exports = router;
