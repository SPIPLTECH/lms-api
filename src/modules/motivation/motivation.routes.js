const express = require("express");
const router = express.Router();

const controller = require("./motivation.controller");
const verifyToken = require("../../middleware/auth.middleware");
const checkRole = require("../../middleware/role.middleware");

// Student-only: a learner sees and dismisses their own nudges, nobody else's.
const studentOnly = checkRole(["STUDENT"]);

router.get("/me", verifyToken, studentOnly, controller.getMine);

router.post("/nudges/:id/dismiss", verifyToken, studentOnly, controller.dismiss);

module.exports = router;
