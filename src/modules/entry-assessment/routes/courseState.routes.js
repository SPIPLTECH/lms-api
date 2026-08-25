const express = require("express");
const router = express.Router();

const verifyToken = require("../../../middleware/auth.middleware");
const validateQuery = require("../middleware/validateQuery.middleware");
const resolveAccess = require("../middleware/resolveAccess.middleware");

const controller = require("../controllers/courseState.controller");
const { studentIdQuerySchema } = require("../validators/entryAssessment.validator");

// Mounted at /student-state — this is the only route left at that prefix
// after the Student State agent's removal (see backup/ai-agents/).
router.use(verifyToken, resolveAccess);

router.get("/course/:courseId", validateQuery(studentIdQuerySchema), controller.getCourseState);

module.exports = router;
