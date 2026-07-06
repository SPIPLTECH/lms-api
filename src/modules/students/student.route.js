const express = require("express");
const router = express.Router();

const studentController = require("./student.controller");
const verifyToken = require("../../middleware/auth.middleware");
const checkRole = require("../../middleware/role.middleware");

router.get(
  "/",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR"]),
  studentController.getStudents
);

router.get(
  "/:studentId",
  verifyToken,
  studentController.getStudentById
);

router.put(
  "/:studentId",
  verifyToken,
  checkRole(["ADMIN", "STUDENT"]),
  studentController.updateStudent
);

router.get(
  "/:studentId/progress",
  verifyToken,
  studentController.getStudentProgress
);

module.exports = router;
