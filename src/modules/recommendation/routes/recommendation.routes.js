const express = require("express");
const router = express.Router();

const verifyToken = require("../../../middleware/auth.middleware");
const validate = require("../../../middleware/joiValidation.middleware");

const resolveStudentAccess = require("../middleware/resolveStudentAccess.middleware");
const validateQuery = require("../middleware/validateQuery.middleware");

const controller = require("../controllers/recommendation.controller");
const { studentIdQuerySchema, recalculateBodySchema, feedbackBodySchema } = require("../validators/recommendation.validator");

router.use(verifyToken, resolveStudentAccess);

// Literal routes MUST be registered before the /:studentId catch-all below,
// or e.g. "/today" would be swallowed as :studentId="today".
router.get("/today", validateQuery(studentIdQuerySchema), controller.getToday);
router.get("/high-priority", validateQuery(studentIdQuerySchema), controller.getHighPriority);
router.get("/revision", validateQuery(studentIdQuerySchema), controller.getRevision);
router.get("/learning", validateQuery(studentIdQuerySchema), controller.getLearning);

router.post("/recalculate", validate(recalculateBodySchema), controller.recalculate);
router.post("/feedback", validate(feedbackBodySchema), controller.feedback);

router.get("/:studentId", controller.getById);

module.exports = router;
