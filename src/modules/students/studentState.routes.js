const express = require("express");
const router = express.Router();

const studentStateController = require("./studentState.controller");
const verifyToken = require("../../middleware/auth.middleware");
const checkRole = require("../../middleware/role.middleware");
const requireContentAccess = require("../../middleware/contentAccess.middleware");

router.get(
  "/",
  verifyToken,
  checkRole(["STUDENT"]),
  requireContentAccess,
  studentStateController.getStudentState
);

router.post(
  "/",
  verifyToken,
  checkRole(["STUDENT"]),
  requireContentAccess,
  studentStateController.updateStudentState
);

module.exports = router;
