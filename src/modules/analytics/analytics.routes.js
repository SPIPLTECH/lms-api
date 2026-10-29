const express = require("express");
const router = express.Router();

const controller = require("./analytics.controller");
const verifyToken = require("../../middleware/auth.middleware");
const checkRole = require("../../middleware/role.middleware");

router.get("/platform", verifyToken, checkRole(["ADMIN"]), controller.getPlatform);
router.get("/courses", verifyToken, checkRole(["ADMIN"]), controller.listCourses);
// Course ownership is enforced in the service (404 for not-yours).
router.get("/course/:courseId", verifyToken, checkRole(["INSTRUCTOR", "ADMIN"]), controller.getCourse);

module.exports = router;
