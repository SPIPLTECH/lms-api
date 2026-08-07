const express = require("express");
const router = express.Router();

const studentCourseStateController = require("./studentCourseState.controller");
const verifyToken = require("../../middleware/auth.middleware");
const checkRole = require("../../middleware/role.middleware");

router.get(
  "/course/:courseId",
  verifyToken,
  checkRole(["STUDENT"]),
  studentCourseStateController.getCourseState
);

module.exports = router;
