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

// The single primary next action for one course, plus any secondary offers.
// Composed from the existing learning path, decision engine and qualification
// rules by a fixed priority table — not a new engine, and no LLM.
router.get(
  "/next-action",
  verifyToken,
  checkRole(["STUDENT", "INSTRUCTOR", "ADMIN"]),
  controller.getNextAction
);

// What to do next, and where the student is weakest. A query parameter for the
// course rather than a nested path, and it returns a list. Produced by the
// existing deterministic decision engine — there is no second recommendation
// service behind this.
router.get(
  "/recommendations",
  verifyToken,
  checkRole(["STUDENT", "INSTRUCTOR", "ADMIN"]),
  controller.getRecommendations
);

// Phase 8: how each concept is holding up over time — retention and transfer,
// derived from the attempt evidence that already exists. A query parameter for
// the course, an array in the response, and no new module: these signals are
// inputs to the existing adaptive pipeline, not a second one.
router.get(
  "/signals",
  verifyToken,
  checkRole(["STUDENT", "INSTRUCTOR", "ADMIN"]),
  controller.getLearningSignals
);

// Phase 9 — instructor analytics over the existing adaptive system.
//
// STUDENT is absent from every role list here by design: these are cohort
// views, and a student has no business reading their classmates' evidence.
// Course ownership is then enforced inside the service, which folds it into
// the lookup so another instructor's course reads as "not found" rather than
// as "forbidden".
router.get(
  "/instructor-insights",
  verifyToken,
  checkRole(["INSTRUCTOR", "ADMIN"]),
  controller.getInstructorInsights
);

router.get(
  "/instructor-learners",
  verifyToken,
  checkRole(["INSTRUCTOR", "ADMIN"]),
  controller.getInstructorLearners
);

router.get(
  "/instructor-learner",
  verifyToken,
  checkRole(["INSTRUCTOR", "ADMIN"]),
  controller.getInstructorLearner
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
