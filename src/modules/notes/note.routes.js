const express = require("express");
const router = express.Router();

const controller = require("./note.controller");
const verifyToken = require("../../middleware/auth.middleware");
const checkRole = require("../../middleware/role.middleware");
const { noteCreateValidation, noteUpdateValidation } = require("./note.validation");

// All routes require authentication as STUDENT
router.get(
  "/",
  verifyToken,
  checkRole(["STUDENT"]),
  controller.getNotes
);

router.get(
  "/:noteId",
  verifyToken,
  checkRole(["STUDENT"]),
  controller.getNoteById
);

router.post(
  "/",
  verifyToken,
  checkRole(["STUDENT"]),
  noteCreateValidation,
  controller.createNote
);

router.put(
  "/:noteId",
  verifyToken,
  checkRole(["STUDENT"]),
  noteUpdateValidation,
  controller.updateNote
);

router.patch(
  "/:noteId/star",
  verifyToken,
  checkRole(["STUDENT"]),
  controller.toggleStar
);

router.delete(
  "/:noteId",
  verifyToken,
  checkRole(["STUDENT"]),
  controller.deleteNote
);

module.exports = router;
