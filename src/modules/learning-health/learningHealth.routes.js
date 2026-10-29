const express = require("express");
const router = express.Router();

const controller = require("./learningHealth.controller");
const verifyToken = require("../../middleware/auth.middleware");
const checkRole = require("../../middleware/role.middleware");

// Instructor/admin only. Students never see risk levels about themselves;
// course ownership is enforced in the service (404 for not-yours).
const instructorOrAdmin = checkRole(["INSTRUCTOR", "ADMIN"]);

router.get("/course/:courseId", verifyToken, instructorOrAdmin, controller.getCourseOverview);

router.get("/course/:courseId/student/:studentId", verifyToken, instructorOrAdmin, controller.getLearnerDetail);

router.post("/course/:courseId/recompute", verifyToken, instructorOrAdmin, controller.recompute);

module.exports = router;
