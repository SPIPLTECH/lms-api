const express = require("express");
const router = express.Router();

const validate = require("../../../middleware/joiValidation.middleware");
const validateQuery = require("../middleware/validateQuery.middleware");

const controller = require("../controllers/entryAssessment.controller");
const { studentIdQuerySchema, submitBodySchema } = require("../validators/entryAssessment.validator");

// Mounted at /assessment/entry — verifyToken + resolveStudentAccess already
// applied by the parent router (see routes/assessment.routes.js).
router.post("/:courseId/generate", controller.generate);
router.get("/:courseId", validateQuery(studentIdQuerySchema), controller.getCurrent);
router.post("/:courseId/submit", validate(submitBodySchema), controller.submit);
router.get("/:courseId/result", validateQuery(studentIdQuerySchema), controller.getResult);

module.exports = router;
