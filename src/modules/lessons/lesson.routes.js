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

router.post(
  "/",
  verifyToken,
  checkRole([
    "ADMIN",
    "INSTRUCTOR"
  ]),
  validate(createLessonSchema),
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
  lessonController.reorderLessons
);

module.exports = router;