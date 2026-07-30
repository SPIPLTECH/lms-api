const express = require("express");
const router = express.Router();

const controller = require("./assignment.controller");
const verifyToken = require("../../middleware/auth.middleware");
const checkRole = require("../../middleware/role.middleware");
const verifyAssignmentOwnership = require("../../middleware/assignmentOwnership.middleware");
const verifyCourseOwnership = require("../../middleware/courseOwnership.middleware");
const validate = require("../../middleware/joiValidation.middleware");
const {
  createAssignmentSchema,
  updateAssignmentSchema,
  submitAssignmentSchema
} = require("./assignment.validation");

router.get(
    "/",
    verifyToken,
    checkRole(["STUDENT", "INSTRUCTOR", "ADMIN"]),
    controller.getAssignments
);

router.get(
    "/:assignmentId",
    verifyToken,
    checkRole(["STUDENT", "INSTRUCTOR", "ADMIN"]),
    controller.getAssignmentById
);

router.post(
    "/",
    verifyToken,
    checkRole(["INSTRUCTOR", "ADMIN"]),
    validate(createAssignmentSchema),
    verifyCourseOwnership.fromBody,
    controller.createAssignment
);

router.put(
    "/:assignmentId",
    verifyToken,
    checkRole(["INSTRUCTOR", "ADMIN"]),
    verifyAssignmentOwnership,
    validate(updateAssignmentSchema),
    controller.updateAssignment
);

router.delete(
    "/:assignmentId",
    verifyToken,
    checkRole(["INSTRUCTOR", "ADMIN"]),
    verifyAssignmentOwnership,
    controller.deleteAssignment
);

router.post(
    "/:assignmentId/submit",
    verifyToken,
    checkRole(["STUDENT"]),
    validate(submitAssignmentSchema),
    controller.submitAssignment
);

module.exports = router;
