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

module.exports = router;
