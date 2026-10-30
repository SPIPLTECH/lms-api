const express = require("express");
const router = express.Router();

const controller = require("./achievement.controller");
const verifyToken = require("../../middleware/auth.middleware");
const checkRole = require("../../middleware/role.middleware");

// Get all achievement definitions (catalog)
router.get(
  "/",
  verifyToken,
  controller.getAchievements
);

// Get the current student's earned achievements + XP total
router.get(
  "/me",
  verifyToken,
  checkRole(["STUDENT"]),
  controller.getMyAchievements
);

// Admin: seed / create an achievement definition
router.post(
  "/",
  verifyToken,
  checkRole(["ADMIN"]),
  controller.createAchievement
);

// Internal: auto-check and award achievements for a student (called by other services)
router.post(
  "/check",
  verifyToken,
  checkRole(["STUDENT"]),
  controller.checkAndAwardAchievements
);

module.exports = router;
