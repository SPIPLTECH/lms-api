const express = require("express");
const router = express.Router();

const controller = require("./studyPlan.controller");
const verifyToken = require("../../middleware/auth.middleware");
const checkRole = require("../../middleware/role.middleware");
const requireContentAccess = require("../../middleware/contentAccess.middleware");

// Course-learning state, so the same rule as learner-model's student routes:
// refused with 409 while another device of the account holds the playback lease.
router.get("/course/:courseId", verifyToken, checkRole(["STUDENT"]), requireContentAccess, controller.getMine);

module.exports = router;
