const express = require("express");

const router = express.Router();

const controller = require("./sticky-note.controller");

const verifyToken = require("../../middleware/auth.middleware");
const verifyStickyNoteOwnership = require("../../middleware/stickyNoteOwnership.middleware");
const validate = require("../../middleware/joiValidation.middleware");
const requireContentAccess = require("../../middleware/contentAccess.middleware");

const {
  stickyNoteCreateSchema,
  stickyNoteUpdateSchema
} = require("./sticky-note.validation");

// While another device holds the playback lease, all sticky-note operations are
// refused (409 CONTENT_ACTIVE_ON_ANOTHER_DEVICE). Sticky notes are course-content
// annotations scoped to the lesson or content item the student is viewing.
router.get(
  "/",
  verifyToken,
  requireContentAccess,
  controller.getStickyNotes
);

router.get(
  "/:stickyNoteId",
  verifyToken,
  requireContentAccess,
  // A note is its student's own: without this any signed-in user could read
  // any note (and its student's details) by id.
  verifyStickyNoteOwnership,
  controller.getStickyNoteById
);

router.post(
  "/",
  verifyToken,
  requireContentAccess,
  validate(stickyNoteCreateSchema),
  controller.createStickyNote
);

router.put(
  "/:stickyNoteId",
  verifyToken,
  requireContentAccess,
  verifyStickyNoteOwnership,
  validate(stickyNoteUpdateSchema),
  controller.updateStickyNote
);

router.patch(
  "/:stickyNoteId/pin",
  verifyToken,
  requireContentAccess,
  verifyStickyNoteOwnership,
  controller.togglePin
);

router.delete(
  "/:stickyNoteId",
  verifyToken,
  requireContentAccess,
  verifyStickyNoteOwnership,
  controller.deleteStickyNote
);

module.exports = router;
