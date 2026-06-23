const express = require("express");

const router = express.Router();

const controller = require(
  "./enrollment.controller"
);

const verifyToken = require(
  "../../middleware/auth.middleware"
);

router.get(
  "/",
  verifyToken,
  controller.getEnrollments
);

router.post(
  "/",
  verifyToken,
  controller.createEnrollment
);

router.delete(
  "/:enrollmentId",
  verifyToken,
  controller.deleteEnrollment
);

module.exports = router;