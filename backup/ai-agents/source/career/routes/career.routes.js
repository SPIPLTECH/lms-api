const express = require("express");
const router = express.Router();

const verifyToken = require("../../../middleware/auth.middleware");
const validate = require("../../../middleware/joiValidation.middleware");

const resolveStudentAccess = require("../middleware/resolveStudentAccess.middleware");
const validateQuery = require("../middleware/validateQuery.middleware");

const controller = require("../controllers/career.controller");
const {
  studentIdQuerySchema,
  roadmapQuerySchema,
  recommendationsQuerySchema,
  recalculateBodySchema,
  goalBodySchema,
} = require("../validators/career.validator");

router.use(verifyToken, resolveStudentAccess);

router.get("/profile/:studentId", controller.getProfile);
router.get("/readiness", validateQuery(studentIdQuerySchema), controller.getReadiness);
router.get("/roles", validateQuery(studentIdQuerySchema), controller.getRoles);
router.get("/roadmap", validateQuery(roadmapQuerySchema), controller.getRoadmap);
router.get("/skill-gaps", validateQuery(studentIdQuerySchema), controller.getSkillGaps);
router.get("/recommendations", validateQuery(recommendationsQuerySchema), controller.getRecommendations);
router.get("/interview-plan", validateQuery(studentIdQuerySchema), controller.getInterviewPlan);

router.post("/recalculate", validate(recalculateBodySchema), controller.recalculate);
router.post("/goal", validate(goalBodySchema), controller.setGoal);

module.exports = router;
