const express = require("express");
const router = express.Router();

const verifyToken = require("../../../middleware/auth.middleware");
const validate = require("../../../middleware/joiValidation.middleware");

const resolveStudentContext = require("../middleware/resolveStudentContext.middleware");
const validateQuery = require("../middleware/validateQuery.middleware");

const observationController = require("../controller/observation.controller");
const {
  createEventSchema,
  listQuerySchema,
  statisticsQuerySchema,
  todayQuerySchema,
} = require("../validation/observation.validation");

// Every route requires an authenticated actor; resolveStudentContext also
// rejects GUEST since LearningEvent.studentId is a required FK.
router.use(verifyToken, resolveStudentContext);

router.post("/", validate(createEventSchema), observationController.createEvent);

router.get(
  "/student/:studentId",
  validateQuery(listQuerySchema),
  observationController.getEventsByStudent
);

router.get(
  "/course/:courseId",
  validateQuery(listQuerySchema),
  observationController.getEventsByCourse
);

router.get(
  "/session/:sessionId",
  validateQuery(listQuerySchema),
  observationController.getEventsBySession
);

router.get(
  "/statistics",
  validateQuery(statisticsQuerySchema),
  observationController.getStatistics
);

router.get(
  "/today",
  validateQuery(todayQuerySchema),
  observationController.getToday
);

module.exports = router;
