const express = require("express");
const router = express.Router();

const controller = require("./results.controller");
const verifyToken = require("../../middleware/auth.middleware");
const checkRole = require("../../middleware/role.middleware");

router.get(
  "/",
  verifyToken,
  checkRole(["INSTRUCTOR", "ADMIN"]),
  controller.getResults
);

// Grouped per Final test, rather than one row per attempt like GET /.
router.get(
  "/final-tests",
  verifyToken,
  checkRole(["INSTRUCTOR", "ADMIN"]),
  controller.getFinalTestOverview
);

module.exports = router;
