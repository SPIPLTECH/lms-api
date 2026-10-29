const express = require("express");
const router = express.Router();

const controller = require("./adminIntelligence.controller");
const verifyToken = require("../../middleware/auth.middleware");
const checkRole = require("../../middleware/role.middleware");

// ADMIN-only, no instructor/student branching (as in the original).
router.get("/dashboard", verifyToken, checkRole(["ADMIN"]), controller.getDashboard);

module.exports = router;
