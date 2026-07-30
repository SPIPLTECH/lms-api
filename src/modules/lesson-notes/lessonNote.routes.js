const express = require("express");
const router = express.Router();

const controller = require("./lessonNote.controller");
const verifyToken = require("../../middleware/auth.middleware");
const checkRole = require("../../middleware/role.middleware");
const verifyLessonOwnership = require("../../middleware/lessonOwnership.middleware");
const validate = require("../../middleware/joiValidation.middleware");
const { createLessonNoteSchema, updateLessonNoteSchema } = require("./lessonNote.validation");

router.get(
  "/",
  verifyToken,
  checkRole(["INSTRUCTOR", "ADMIN"]),
  verifyLessonOwnership.fromQuery,
  controller.getNotes
);

router.post(
  "/",
  verifyToken,
  checkRole(["INSTRUCTOR", "ADMIN"]),
  validate(createLessonNoteSchema),
  verifyLessonOwnership.fromBody,
  controller.createNote
);

router.put(
  "/:noteId",
  verifyToken,
  checkRole(["INSTRUCTOR", "ADMIN"]),
  validate(updateLessonNoteSchema),
  controller.updateNote
);

router.delete(
  "/:noteId",
  verifyToken,
  checkRole(["INSTRUCTOR", "ADMIN"]),
  controller.deleteNote
);

module.exports = router;
