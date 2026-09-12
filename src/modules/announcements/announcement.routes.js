const express = require("express");
const router = express.Router();

const controller = require("./announcement.controller");
const verifyToken = require("../../middleware/auth.middleware");
const checkRole = require("../../middleware/role.middleware");

router.get(
  "/",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR"]),
  controller.getAnnouncements
);

module.exports = router;
