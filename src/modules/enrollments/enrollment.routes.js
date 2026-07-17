const express = require("express");
const router = express.Router();

const controller = require("./enrollment.controller");

const verifyToken = require("../../middleware/auth.middleware");

const checkEnrollmentAccess = require(
  "../../middleware/enrollment.middleware"
);

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