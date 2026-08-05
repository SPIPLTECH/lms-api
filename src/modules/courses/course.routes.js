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
const { optionalToken } = require(
  "../../middleware/auth.middleware"
);

const checkRole = require(
  "../../middleware/role.middleware"
);

const verifyCourseOwnership = require(
  "../../middleware/courseOwnership.middleware"
);
const { verifyBatchOwnership } = require(
  "../../middleware/courseOwnership.middleware"
);
const validate = require("../../middleware/joiValidation.middleware");
const {
  createCourseSchema,
  updateCourseSchema,
  updateCourseStatusSchema,
  sendAnnouncementSchema,
  createCourseBatchSchema,
  addStudentToBatchSchema,
  updateBatchStatusSchema,
  createBatchAnnouncementSchema
} = require("./course.validation");

// Public read — optionalToken allows unauthenticated (GUEST) access.
// The service layer already filters: guests/students see only PUBLISHED courses;
// admins/instructors see all. verifyToken is NOT used here because guests
// must be able to browse the course catalogue without a token.
router.get(
  "/",
  optionalToken,
  checkRole([
    "ADMIN",
    "INSTRUCTOR",
    "STUDENT",
    "GUEST",
  ]),
  controller.getCourses
);

router.get(
  "/stats/mine",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR"]),
  controller.getCourseStatusCounts
);

// Public read — optionalToken allows unauthenticated access for course preview.
// Students/guests only receive PUBLISHED course data; the service enforces this.
router.get(
  "/:courseId",
  optionalToken,
  controller.getCourseById
);

router.post(
  "/",
  verifyToken,
  checkRole([
    "ADMIN",
    "INSTRUCTOR"
  ]),
  validate(createCourseSchema),
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
  validate(updateCourseSchema),
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
  validate(updateCourseStatusSchema),
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
router.post(
  "/:courseId/duplicate",
  verifyToken,
  checkRole([
    "ADMIN",
    "INSTRUCTOR"
  ]),
  verifyCourseOwnership,
  controller.duplicateCourse
);

router.get(
  "/:courseId/students",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR"]),
  verifyCourseOwnership,
  controller.getCourseStudents
);

router.post(
  "/:courseId/announcements",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR"]),
  verifyCourseOwnership,
  validate(sendAnnouncementSchema),
  controller.sendAnnouncement
);

router.get(
  "/batches/mine",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR"]),
  controller.getInstructorBatches
);

router.get(
  "/batches/overview",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR"]),
  controller.getBatchPerformanceOverview
);

router.get(
  "/:courseId/batches",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR"]),
  verifyCourseOwnership,
  controller.getCourseBatches
);

router.post(
  "/:courseId/batches",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR"]),
  verifyCourseOwnership,
  validate(createCourseBatchSchema),
  controller.createCourseBatch
);

router.get(
  "/batches/:batchId",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR"]),
  verifyBatchOwnership,
  controller.getBatchById
);

router.get(
  "/batches/:batchId/enrollable-students",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR"]),
  verifyBatchOwnership,
  controller.getEnrollableStudentsForBatch
);

router.post(
  "/batches/:batchId/students",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR"]),
  verifyBatchOwnership,
  validate(addStudentToBatchSchema),
  controller.addStudentToBatch
);

router.delete(
  "/batches/:batchId/students/:studentId",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR"]),
  verifyBatchOwnership,
  controller.removeStudentFromBatch
);

router.get(
  "/batches/:batchId/dashboard",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR"]),
  verifyBatchOwnership,
  controller.getBatchDetailDashboard
);

router.patch(
  "/batches/:batchId/status",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR"]),
  verifyBatchOwnership,
  validate(updateBatchStatusSchema),
  controller.updateBatchStatus
);

router.get(
  "/batches/:batchId/announcements",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR"]),
  verifyBatchOwnership,
  controller.getBatchAnnouncements
);

router.post(
  "/batches/:batchId/announcements",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR"]),
  verifyBatchOwnership,
  validate(createBatchAnnouncementSchema),
  controller.createBatchAnnouncement
);

router.post(
  "/batches/:batchId/message",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR"]),
  verifyBatchOwnership,
  controller.startBatchConversation
);

module.exports = router;