const express = require("express");
const router = express.Router();

const verifyToken = require("../../middleware/auth.middleware");
const checkRole = require("../../middleware/role.middleware");
const validate = require("../../middleware/joiValidation.middleware");

const adaptiveLearningController = require("./adaptiveLearning.controller");
const {
  respondSchema,
  generateVerificationQuestionSchema,
  evaluateVerificationAnswerSchema,
} = require("./adaptiveLearning.validation");

router.post(
  "/respond",
  verifyToken,
  checkRole(["STUDENT", "INSTRUCTOR", "ADMIN"]),
  validate(respondSchema),
  adaptiveLearningController.respond
);

// Same auth, role check, and request payload as /respond — only the
// delivery mechanism differs (SSE chunks instead of one buffered JSON body).
router.post(
  "/respond/stream",
  verifyToken,
  checkRole(["STUDENT", "INSTRUCTOR", "ADMIN"]),
  validate(respondSchema),
  adaptiveLearningController.respondStream
);

// Closes the adaptive loop after a MISCONCEPTION_REMEDIATION response — see
// adaptiveLearning.service.js#generateVerificationQuestion /
// #evaluateVerificationAnswer for why these are stateless (no new tables).
router.post(
  "/verification/generate",
  verifyToken,
  checkRole(["STUDENT", "INSTRUCTOR", "ADMIN"]),
  validate(generateVerificationQuestionSchema),
  adaptiveLearningController.generateVerificationQuestion
);

router.post(
  "/verification/evaluate",
  verifyToken,
  checkRole(["STUDENT", "INSTRUCTOR", "ADMIN"]),
  validate(evaluateVerificationAnswerSchema),
  adaptiveLearningController.evaluateVerificationAnswer
);

module.exports = router;
