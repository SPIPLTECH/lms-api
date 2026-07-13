const express = require("express");
const router = express.Router();

const controller = require("./live-class.controller");
const verifyToken = require("../../middleware/auth.middleware");
const checkRole = require("../../middleware/role.middleware");
const { liveClassCreateValidation, liveClassUpdateValidation } = require("./live-class.validation");

// Public: list upcoming live classes (students can browse by courseId)
router.get(
  "/",
  verifyToken,
  controller.getLiveClasses
);

router.get(
  "/:liveClassId",
  verifyToken,
  controller.getLiveClassById
);

// Instructor / Admin: create, update, delete
router.post(
  "/",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR"]),
  liveClassCreateValidation,
  controller.createLiveClass
);

router.put(
  "/:liveClassId",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR"]),
  liveClassUpdateValidation,
  controller.updateLiveClass
);

// Patch just the status (go live, complete, cancel)
router.patch(
  "/:liveClassId/status",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR"]),
  controller.updateStatus
);

router.delete(
  "/:liveClassId",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR"]),
  controller.deleteLiveClass
);

module.exports = router;
