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

// Admin: award an achievement to a specific student
router.post(
  "/:achievementId/award/:studentProfileId",
  verifyToken,
  checkRole(["ADMIN"]),
  controller.awardAchievement
);

// Internal: auto-check and award achievements for a student (called by other services)
router.post(
  "/check",
  verifyToken,
  checkRole(["STUDENT"]),
  controller.checkAndAwardAchievements
);

module.exports = router;
