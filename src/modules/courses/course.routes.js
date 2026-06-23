const express = require(
  "express"
);

const router = express.Router();

const controller = require(
  "./course.controller"
);

const verifyToken = require(
  "../../middleware/auth.middleware"
);

const checkRole = require(
  "../../middleware/role.middleware"
);

const verifyCourseOwnership = require(
  "../../middleware/courseOwnership.middleware"
);

router.get(
  "/",
  controller.getCourses
);

router.get(
  "/:courseId",
  controller.getCourseById
);

router.post(
  "/",
  verifyToken,
  checkRole([
    "ADMIN",
    "INSTRUCTOR"
  ]),
  controller.createCourse
);

router.put(
  "/:courseId",
  verifyToken,
  checkRole([
    "ADMIN",
    "INSTRUCTOR"
  ]),
  verifyCourseOwnership,
  controller.updateCourse
);

router.patch(
  "/:courseId/status",
  verifyToken,
  checkRole([
    "ADMIN",
    "INSTRUCTOR"
  ]),
  verifyCourseOwnership,
  controller.updateStatus
);

router.delete(
  "/:courseId",
  verifyToken,
  checkRole([
    "ADMIN",
    "INSTRUCTOR"
  ]),
  verifyCourseOwnership,
  controller.deleteCourse
);
router.get(
  "/:courseId/students",
  verifyToken,
  controller.getCourseStudents
);

module.exports = router;