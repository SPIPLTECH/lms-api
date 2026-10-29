const express = require("express");
const router = express.Router();

const controller = require("./career.controller");
const verifyToken = require("../../middleware/auth.middleware");
const checkRole = require("../../middleware/role.middleware");

const studentOnly = checkRole(["STUDENT"]);

router.get("/roles", verifyToken, controller.listRoles);
router.get("/me", verifyToken, studentOnly, controller.getMine);
router.put("/goal", verifyToken, studentOnly, controller.setGoal);

module.exports = router;
