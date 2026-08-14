const express = require("express");
const router = express.Router();

const verifyToken = require("../../../middleware/auth.middleware");
const validate = require("../../../middleware/joiValidation.middleware");

const resolveStudentAccess = require("../middleware/resolveStudentAccess.middleware");
const validateQuery = require("../middleware/validateQuery.middleware");

const controller = require("../controllers/studentState.controller");
const { studentIdQuerySchema, recalculateBodySchema } = require("../validators/studentState.validator");

router.use(verifyToken, resolveStudentAccess);

// Literal routes MUST be registered before the /:studentId catch-all below,
// or e.g. "/dashboard" would be swallowed as :studentId="dashboard".
router.get("/dashboard", validateQuery(studentIdQuerySchema), controller.getDashboard);
router.get("/progress", validateQuery(studentIdQuerySchema), controller.getProgress);
router.get("/performance", validateQuery(studentIdQuerySchema), controller.getPerformance);
router.get("/engagement", validateQuery(studentIdQuerySchema), controller.getEngagement);
router.get("/behavior", validateQuery(studentIdQuerySchema), controller.getBehavior);
router.get("/risk", validateQuery(studentIdQuerySchema), controller.getRisk);
router.get("/course/:courseId", validateQuery(studentIdQuerySchema), controller.getCourseState);

router.post("/recalculate", validate(recalculateBodySchema), controller.recalculate);

router.get("/:studentId", controller.getById);

module.exports = router;
