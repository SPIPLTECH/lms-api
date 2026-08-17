const express = require("express");
const router = express.Router();
const verifyToken = require("../../middleware/auth.middleware");
const checkRole = require("../../middleware/role.middleware");
const learningPathController = require("./learningPath.controller");

router.get(
  "/:studentId",
  verifyToken,
  checkRole(["STUDENT", "INSTRUCTOR", "ADMIN"]),
  learningPathController.getLearningPath
);

router.get(
  "/",
  verifyToken,
  checkRole(["STUDENT", "INSTRUCTOR", "ADMIN"]),
  learningPathController.getLearningPath
);

module.exports = router;
