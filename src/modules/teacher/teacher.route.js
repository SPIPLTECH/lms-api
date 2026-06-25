const express = require("express");
const router = express.Router();

const teacherController = require("./teacher.controller");
const verifyToken = require("../../middleware/auth.middleware");
const checkRole = require("../../middleware/role.middleware");

router.get(
  "/",
  verifyToken,
  checkRole(["ADMIN"]),
  teacherController.getTeachers
);

router.get(
  "/:teacherId",
  verifyToken,
  teacherController.getTeacherById
);

router.put(
  "/:teacherId",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR"]),
  teacherController.updateTeacher
);

router.get(
  "/:teacherId/courses",
  verifyToken,
  teacherController.getTeacherCourses
);

module.exports = router;
