const express = require("express");
const router = express.Router();

const verifyToken = require("../../../middleware/auth.middleware");
const validate = require("../../../middleware/joiValidation.middleware");

const resolveStudentAccess = require("../middleware/resolveStudentAccess.middleware");
const validateQuery = require("../middleware/validateQuery.middleware");

const controller = require("../controllers/assessment.controller");
const entryAssessmentRoutes = require("./entryAssessment.routes");
const {
  studentIdQuerySchema,
  historyQuerySchema,
  evaluateBodySchema,
  recalculateBodySchema,
} = require("../validators/assessment.validator");

router.use(verifyToken, resolveStudentAccess);

// Literal routes MUST be registered before the /:studentId catch-all
// below, or e.g. "/mastery" would be swallowed as :studentId="mastery".
// Same reason "/entry" is a sub-router mounted here, not after.
router.use("/entry", entryAssessmentRoutes);

router.get("/mastery", validateQuery(studentIdQuerySchema), controller.getMastery);
router.get("/history", validateQuery(historyQuerySchema), controller.getHistory);
router.get("/knowledge-gaps", validateQuery(studentIdQuerySchema), controller.getKnowledgeGaps);
router.get("/recommendations", validateQuery(studentIdQuerySchema), controller.getRecommendations);
router.get("/reassessment-plan", validateQuery(studentIdQuerySchema), controller.getReassessmentPlan);

router.post("/evaluate", validate(evaluateBodySchema), controller.evaluate);
router.post("/recalculate", validate(recalculateBodySchema), controller.recalculate);

router.get("/:studentId", controller.getById);

module.exports = router;
