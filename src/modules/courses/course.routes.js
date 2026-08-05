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
const { verifyBatchOwnership, verifyBatchAccess } = require(
  "../../middleware/courseOwnership.middleware"
);
const checkEnrollmentAccess = require(
  "../../middleware/enrollment.middleware"
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

// Student read-only counterpart of "/batches/mine" above — batches the
// student is a member of, not batches they teach. checkEnrollmentAccess
// resolves req.studentId from the authenticated user (same middleware
// already used by GET /enrollments).
router.get(
  "/batches/student/mine",
  verifyToken,
  checkRole(["STUDENT"]),
  checkEnrollmentAccess,
  controller.getMyStudentBatches
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

// Read-only: instructor/admin owner OR a student who is a member of this
// batch (verifyBatchAccess covers both; management routes below keep the
// stricter owner-only verifyBatchOwnership).
router.get(
  "/batches/:batchId",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR", "STUDENT"]),
  verifyBatchAccess,
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
  checkRole(["ADMIN", "INSTRUCTOR", "STUDENT"]),
  verifyBatchAccess,
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
  checkRole(["ADMIN", "INSTRUCTOR", "STUDENT"]),
  verifyBatchAccess,
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