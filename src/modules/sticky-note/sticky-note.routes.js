const express = require("express");

const router = express.Router();

const controller = require("./sticky-note.controller");

const verifyToken = require("../../middleware/auth.middleware");
const verifyStickyNoteOwnership = require("../../middleware/stickyNoteOwnership.middleware");
const validate = require("../../middleware/joiValidation.middleware");

const {
  stickyNoteCreateSchema,
  stickyNoteUpdateSchema
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
  validate(stickyNoteCreateSchema),
  controller.createStickyNote
);

router.put(
  "/:stickyNoteId",
  verifyToken,
  verifyStickyNoteOwnership,
  validate(stickyNoteUpdateSchema),
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