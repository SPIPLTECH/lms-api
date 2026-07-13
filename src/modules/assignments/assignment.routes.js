const express = require("express");
const router = express.Router();

const controller = require("./assignment.controller");
const verifyToken = require("../../middleware/auth.middleware");
const checkRole = require("../../middleware/role.middleware");

router.get(
    "/",
    verifyToken,
    checkRole(["STUDENT"]),
    controller.getAssignments
);

router.get(
    "/:assignmentId",
    verifyToken,
    checkRole(["STUDENT"]),
    controller.getAssignmentById
);

router.post(
    "/:assignmentId/submit",
    verifyToken,
    checkRole(["STUDENT"]),
    controller.submitAssignment
);

module.exports = router;
