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

router.get(
  "/",
  lessonController.getLessons
);

router.get(
  "/:lessonId",
  lessonController.getLessonById
);

router.post(
  "/",
  verifyToken,
  checkRole([
    "ADMIN",
    "INSTRUCTOR"
  ]),
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
  lessonController.reorderLessons
);

module.exports = router;