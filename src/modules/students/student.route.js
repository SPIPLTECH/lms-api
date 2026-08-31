const express = require("express");
const router = express.Router();

const studentController = require("./student.controller");
const studentStateRoutes = require("./studentState.routes");
const verifyToken = require("../../middleware/auth.middleware");
const checkRole = require("../../middleware/role.middleware");
const validate = require("../../middleware/joiValidation.middleware");
const { updateStudentSchema } = require("./student.validation");

router.use("/state", studentStateRoutes);

router.get(
  "/",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR"]),
  studentController.getStudents
);

router.get(
  "/:studentId",
  verifyToken,
  studentController.getStudentById
);

router.put(
  "/:studentId",
  verifyToken,
  checkRole(["ADMIN", "STUDENT"]),
  validate(updateStudentSchema),
  studentController.updateStudent
);

router.get(
  "/:studentId/progress",
  verifyToken,
  studentController.getStudentProgress
);

module.exports = router;
