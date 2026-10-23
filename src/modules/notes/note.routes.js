const express = require("express");
const router = express.Router();

const controller = require("./note.controller");
const verifyToken = require("../../middleware/auth.middleware");
const checkRole = require("../../middleware/role.middleware");
const validate = require("../../middleware/joiValidation.middleware");
const { noteCreateSchema, noteUpdateSchema } = require("./note.validation");
const requireContentAccess = require("../../middleware/contentAccess.middleware");

// All routes require authentication as STUDENT; while another device holds the
// playback lease, every note operation is refused (409 CONTENT_ACTIVE_ON_ANOTHER_DEVICE).
router.get(
  "/",
  verifyToken,
  checkRole(["STUDENT"]),
  requireContentAccess,
  controller.getNotes
);

router.get(
  "/:noteId",
  verifyToken,
  checkRole(["STUDENT"]),
  requireContentAccess,
  controller.getNoteById
);

router.post(
  "/",
  verifyToken,
  checkRole(["STUDENT"]),
  requireContentAccess,
  validate(noteCreateSchema),
  controller.createNote
);

router.put(
  "/:noteId",
  verifyToken,
  checkRole(["STUDENT"]),
  requireContentAccess,
  validate(noteUpdateSchema),
  controller.updateNote
);

router.patch(
  "/:noteId/star",
  verifyToken,
  checkRole(["STUDENT"]),
  requireContentAccess,
  controller.toggleStar
);

router.delete(
  "/:noteId",
  verifyToken,
  checkRole(["STUDENT"]),
  requireContentAccess,
  controller.deleteNote
);

module.exports = router;
