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

  verifyToken,
  checkRole([
    "ADMIN",
    "INSTRUCTOR",
    "STUDENT",
    "GUEST",
  ]),
  controller.getCourses
);

router.get(
  "/:courseId",
  verifyToken,
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

router.post(
  "/:courseId/announcements",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR"]),
  verifyCourseOwnership,
  controller.sendAnnouncement
);

router.get(
  "/:courseId/batches",
  verifyToken,
  controller.getCourseBatches
);

router.post(
  "/:courseId/batches",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR"]),
  verifyCourseOwnership,
  controller.createCourseBatch
);

module.exports = router;