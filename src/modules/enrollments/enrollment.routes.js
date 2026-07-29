const express = require("express");
const router = express.Router();

const controller = require("./enrollment.controller");

const verifyToken = require("../../middleware/auth.middleware");

const checkEnrollmentAccess = require(
  "../../middleware/enrollment.middleware"
);
const validate = require("../../middleware/joiValidation.middleware");
const { createEnrollmentSchema } = require("./enrollment.validation");

router.get(
  "/",
  verifyToken,
  checkEnrollmentAccess,
  controller.getEnrollments
);

router.post(
  "/",
  verifyToken,
  checkEnrollmentAccess,
  validate(createEnrollmentSchema),
  controller.createEnrollment
);

router.delete(
  "/:enrollmentId",
  verifyToken,
  checkEnrollmentAccess,
  controller.deleteEnrollment
);

router.patch(
  "/:courseId/access",
  verifyToken,
  checkEnrollmentAccess,
  controller.trackCourseAccess
);

module.exports = router;