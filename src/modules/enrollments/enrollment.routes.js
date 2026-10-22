const express = require("express");
const router = express.Router();

const controller = require("./enrollment.controller");

const verifyToken = require("../../middleware/auth.middleware");

const checkEnrollmentAccess = require(
  "../../middleware/enrollment.middleware"
);
const verifyEnrollmentOwnership = require(
  "../../middleware/enrollmentOwnership.middleware"
);
const validate = require("../../middleware/joiValidation.middleware");
const { createEnrollmentSchema } = require("./enrollment.validation");
const requireContentAccess = require("../../middleware/contentAccess.middleware");

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
  verifyEnrollmentOwnership,
  controller.deleteEnrollment
);

router.patch(
  "/:courseId/access",
  verifyToken,
  checkEnrollmentAccess,
  requireContentAccess,
  controller.trackCourseAccess
);

module.exports = router;
