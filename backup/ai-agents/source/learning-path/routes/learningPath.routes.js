const express = require("express");
const router = express.Router();

const verifyToken = require("../../../middleware/auth.middleware");
const validate = require("../../../middleware/joiValidation.middleware");

const resolveStudentAccess = require("../middleware/resolveStudentAccess.middleware");
const validateQuery = require("../middleware/validateQuery.middleware");

const controller = require("../controllers/learningPath.controller");
const { studentIdQuerySchema, recommendationsQuerySchema, milestonesQuerySchema, recalculateBodySchema } = require("../validators/learningPath.validator");

router.use(verifyToken, resolveStudentAccess);

// Literal routes MUST be registered before the /:studentId catch-all below,
// or e.g. "/next" would be swallowed as :studentId="next".
router.get("/next", validateQuery(studentIdQuerySchema), controller.getNext);
router.get("/daily-plan", validateQuery(studentIdQuerySchema), controller.getDailyPlan);
router.get("/weekly-plan", validateQuery(studentIdQuerySchema), controller.getWeeklyPlan);
router.get("/recommendations", validateQuery(recommendationsQuerySchema), controller.getRecommendations);
router.get("/milestones", validateQuery(milestonesQuerySchema), controller.getMilestones);

router.post("/recalculate", validate(recalculateBodySchema), controller.recalculate);

router.get("/:studentId", controller.getProfile);

module.exports = router;
