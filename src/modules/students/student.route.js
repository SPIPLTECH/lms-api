const express = require("express");
const router = express.Router();

const studentController = require("./student.controller");
const studentStateRoutes = require("./studentState.routes");
const verifyToken = require("../../middleware/auth.middleware");
const checkRole = require("../../middleware/role.middleware");
const validate = require("../../middleware/joiValidation.middleware");
const verifyStudentOwnership = require("../../middleware/studentOwnership.middleware");
const { updateStudentSchema } = require("./student.validation");

router.use("/state", studentStateRoutes);

router.get(
  "/",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR"]),
  studentController.getStudents
);

// Staff may open any student (the list above already shows them all to
// ADMIN and INSTRUCTOR); a student only their own profile.
router.get(
  "/:studentId",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR", "STUDENT"]),
  verifyStudentOwnership(["ADMIN", "INSTRUCTOR"]),
  studentController.getStudentById
);

// Only ADMIN may edit any profile; a student only their own. The Joi schema
// strips every field that isn't a student-editable profile field.
router.put(
  "/:studentId",
  verifyToken,
  checkRole(["ADMIN", "STUDENT"]),
  verifyStudentOwnership(["ADMIN"]),
  validate(updateStudentSchema),
  studentController.updateStudent
);

module.exports = router;
