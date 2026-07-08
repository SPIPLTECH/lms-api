const express = require("express");

const router = express.Router();

const controller = require("./sticky-note.controller");

const verifyToken = require("../../middleware/auth.middleware");
const verifyStickyNoteOwnership = require("../../middleware/stickyNoteOwnership.middleware");

const {
  stickyNoteCreateValidation,
  stickyNoteUpdateValidation
} = require("./sticky-note.validation");

router.get(
  "/",
  verifyToken,
  controller.getStickyNotes
);

router.get(
  "/:stickyNoteId",
  verifyToken,
  controller.getStickyNoteById
);

router.post(
  "/",
  verifyToken,
  stickyNoteCreateValidation,
  controller.createStickyNote
);

router.put(
  "/:stickyNoteId",
  verifyToken,
  verifyStickyNoteOwnership,
  stickyNoteUpdateValidation,
  controller.updateStickyNote
);

router.patch(
  "/:stickyNoteId/pin",
  verifyToken,
  verifyStickyNoteOwnership,
  controller.togglePin
);

router.delete(
  "/:stickyNoteId",
  verifyToken,
  verifyStickyNoteOwnership,
  controller.deleteStickyNote
);

module.exports = router;