const express = require("express");
const router = express.Router();

const controller = require("./learnerModel.controller");
const verifyToken = require("../../middleware/auth.middleware");
const checkRole = require("../../middleware/role.middleware");
const validate = require("../../middleware/joiValidation.middleware");
const {
  initializeSchema,
  recordEvidenceSchema,
  recordMisconceptionSchema,
  getDecisionSchema,
} = require("./learnerModel.validation");

router.get(
  "/",
  verifyToken,
  checkRole(["STUDENT", "INSTRUCTOR", "ADMIN"]),
  controller.getLearnerState
);

router.post(
  "/initialize",
  verifyToken,
  checkRole(["STUDENT", "INSTRUCTOR", "ADMIN"]),
  validate(initializeSchema),
  controller.initializeLearnerState
);

router.post(
  "/evidence",
  verifyToken,
  checkRole(["STUDENT", "INSTRUCTOR", "ADMIN"]),
  validate(recordEvidenceSchema),
  controller.recordEvidence
);

router.post(
  "/misconception",
  verifyToken,
  checkRole(["STUDENT", "INSTRUCTOR", "ADMIN"]),
  validate(recordMisconceptionSchema),
  controller.recordMisconception
);

router.post(
  "/decision",
  verifyToken,
  checkRole(["STUDENT", "INSTRUCTOR", "ADMIN"]),
  validate(getDecisionSchema),
  controller.getPedagogicalDecision
);

module.exports = router;
