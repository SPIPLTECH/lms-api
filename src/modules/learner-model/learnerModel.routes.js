const express = require("express");
const router = express.Router();

const controller = require("./learnerModel.controller");
const verifyToken = require("../../middleware/auth.middleware");
const checkRole = require("../../middleware/role.middleware");
const requireContentAccess = require("../../middleware/contentAccess.middleware");

// The single primary next action for one course, plus any secondary offers.
// Composed from the existing learning path, decision engine and qualification
// rules by a fixed priority table — not a new engine, and no LLM.
router.get(
  "/next-action",
  verifyToken,
  checkRole(["STUDENT", "INSTRUCTOR", "ADMIN"]),
  requireContentAccess,
  controller.getNextAction
);

module.exports = router;
