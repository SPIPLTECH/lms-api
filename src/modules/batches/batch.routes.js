const express = require("express");
const router = express.Router();

const controller = require("./batch.controller");
const verifyToken = require("../../middleware/auth.middleware");
const checkRole = require("../../middleware/role.middleware");
const validate = require("../../middleware/joiValidation.middleware");
const verifyCourseOwnership = require("../../middleware/courseOwnership.middleware");
const {
  verifyBatchOwnership,
  verifyBatchCourseIdsOwnership,
} = require("../../middleware/batchOwnership.middleware");

const {
  createBatchSchema,
  updateBatchSchema,
  updateBatchStatusSchema,
  addStudentToBatchSchema,
  createBatchAnnouncementSchema,
} = require("./batch.validation");

router.get(
  "/",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR"]),
  controller.listBatches
);

router.get(
  "/overview",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR"]),
  controller.getBatchPerformanceOverview
);

router.post(
  "/",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR"]),
  validate(createBatchSchema),
  verifyBatchCourseIdsOwnership,
  controller.createBatch
);

router.get(
  "/:batchId",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR"]),
  verifyBatchOwnership,
  controller.getBatchById
);

router.patch(
  "/:batchId",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR"]),
  verifyBatchOwnership,
  validate(updateBatchSchema),
  controller.updateBatch
);

router.patch(
  "/:batchId/status",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR"]),
  verifyBatchOwnership,
  validate(updateBatchStatusSchema),
  controller.updateBatchStatus
);

router.delete(
  "/:batchId",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR"]),
  verifyBatchOwnership,
  controller.deleteBatch
);

// Attaching a course to a batch requires owning both: the batch (verifyBatchOwnership,
// via req.params.batchId) and the course being attached (verifyCourseOwnership, via
// req.params.courseId) — otherwise an instructor could pull another instructor's
// course into their own batch.
router.post(
  "/:batchId/courses/:courseId",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR"]),
  verifyBatchOwnership,
  verifyCourseOwnership,
  controller.addCourseToBatch
);

router.delete(
  "/:batchId/courses/:courseId",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR"]),
  verifyBatchOwnership,
  controller.removeCourseFromBatch
);

router.get(
  "/:batchId/enrollable-students",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR"]),
  verifyBatchOwnership,
  controller.getEnrollableStudentsForBatch
);

router.post(
  "/:batchId/students",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR"]),
  verifyBatchOwnership,
  validate(addStudentToBatchSchema),
  controller.addStudentToBatch
);

router.delete(
  "/:batchId/students/:studentId",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR"]),
  verifyBatchOwnership,
  controller.removeStudentFromBatch
);

router.get(
  "/:batchId/dashboard",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR"]),
  verifyBatchOwnership,
  controller.getBatchDetailDashboard
);

router.get(
  "/:batchId/quizzes",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR"]),
  verifyBatchOwnership,
  controller.getBatchQuizzes
);

router.get(
  "/:batchId/announcements",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR"]),
  verifyBatchOwnership,
  controller.getBatchAnnouncements
);

router.post(
  "/:batchId/announcements",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR"]),
  verifyBatchOwnership,
  validate(createBatchAnnouncementSchema),
  controller.createBatchAnnouncement
);

router.post(
  "/:batchId/message",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR"]),
  verifyBatchOwnership,
  controller.startBatchConversation
);

module.exports = router;
