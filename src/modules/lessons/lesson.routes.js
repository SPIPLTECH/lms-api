 const express = require("express");

const router = express.Router();

const lessonController = require(
  "./lesson.controller"
);

const verifyToken = require(
  "../../middleware/auth.middleware"
);

const checkRole = require(
  "../../middleware/role.middleware"
);

const verifyLessonOwnership =
  require(
    "../../middleware/lessonOwnership.middleware"
  );
const verifyModuleOwnership =
  require(
    "../../middleware/moduleOwnership.middleware"
  );
const validate = require("../../middleware/joiValidation.middleware");
const {
  createLessonSchema,
  updateLessonSchema,
  reorderLessonsSchema
} = require("./lesson.validation");

router.get(
  "/",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR", "STUDENT"]),
  lessonController.getLessons
);

router.get(
  "/:lessonId",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR", "STUDENT"]),
  lessonController.getLessonById
);

router.get(
  "/:lessonId/transcript",
  verifyToken,
  lessonController.getLessonTranscript
);

router.post(
  "/",
  verifyToken,
  checkRole([
    "ADMIN",
    "INSTRUCTOR"
  ]),
  validate(createLessonSchema),
  verifyModuleOwnership.fromBody,
  lessonController.createLesson
);

router.put(
  "/:lessonId",
  verifyToken,
  checkRole([
    "ADMIN",
    "INSTRUCTOR"
  ]),
  verifyLessonOwnership,
  validate(updateLessonSchema),
  lessonController.updateLesson
);

router.delete(
  "/:lessonId",
  verifyToken,
  checkRole([
    "ADMIN",
    "INSTRUCTOR"
  ]),
  verifyLessonOwnership,
  lessonController.deleteLesson
);

router.patch(
  "/reorder",
  verifyToken,
  checkRole([
    "ADMIN",
    "INSTRUCTOR"
  ]),
  validate(reorderLessonsSchema),
  verifyModuleOwnership.fromBody,
  lessonController.reorderLessons
);

module.exports = router;