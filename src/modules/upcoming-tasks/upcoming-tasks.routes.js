const express = require("express");
const router = express.Router();
const verifyToken = require("../../middleware/auth.middleware");
const { getMyUpcomingTasks } = require("./upcoming-tasks.controller");

// GET /upcoming-tasks — get upcoming tasks for the logged-in student
router.get("/", verifyToken, getMyUpcomingTasks);

module.exports = router;
