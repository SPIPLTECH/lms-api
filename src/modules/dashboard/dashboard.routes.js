const express = require("express");
const router = express.Router();

const dashboardController = require("./dashboard.controller");
const authMiddleware = require("../../middleware/auth.middleware");
const checkRole = require("../../middleware/role.middleware");

// Admin dashboard
router.get(
  "/admin",
  authMiddleware,
  checkRole(["ADMIN"]),
  dashboardController.getAdminDashboard
);

// Teacher dashboard
router.get(
  "/instructor",
  authMiddleware,
  checkRole(["INSTRUCTOR"]),
  dashboardController.getInstructorDashboard
);

// Student dashboard
router.get(
  "/student",
  authMiddleware,
  checkRole(["STUDENT"]),
  dashboardController.getStudentDashboard
);

module.exports = router;