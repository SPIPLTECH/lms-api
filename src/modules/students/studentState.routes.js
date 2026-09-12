const express = require("express");
const router = express.Router();

const studentStateController = require("./studentState.controller");
const verifyToken = require("../../middleware/auth.middleware");
const checkRole = require("../../middleware/role.middleware");

router.get(
  "/",
  verifyToken,
  checkRole(["STUDENT"]),
  studentStateController.getStudentState
);

router.post(
  "/",
  verifyToken,
  checkRole(["STUDENT"]),
  studentStateController.updateStudentState
);

module.exports = router;
